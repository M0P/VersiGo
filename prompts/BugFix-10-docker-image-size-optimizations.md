# BugFix-10 – Docker image size optimizations (#1, #2, #4)

Source: user request (2026-08-07) — "do you see any possibility to reduce the size of the production builds further?" followed by "do #1, #2 and #4" after the size analysis.

## Context (what exists today)

- Branch `fix/BugFix-09-ci-fix-community-standards-dockerhub`; BugFix-09 committed (`e97eb95` + `a576321`, 2 review rounds, 0/0/0/0). Handoff: `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` (currently states "no next package" — will be rewritten after this package).
- Measured image sizes (BugFix-07 figures): **api ~371 MB, worker ~365 MB, web ~207 MB** (prod-deps, `--prod`, no `--no-strip`).
- Root cause of the biggest leak: `prisma` is a **direct runtime dependency** of `apps/api` and `apps/worker` (unlike `packages/foundation`, where it is already a devDependency). `pnpm deploy --prod` therefore copies the whole Prisma CLI graph (prisma 67 MB + @prisma/engines 36 MB + effect 31 MB + @prisma/config 78 KB ≈ 134 MB). The BugFix-07 cleanup removes `prisma@*` + `@prisma/engines@*` from the runtime copy but NOT `effect@3.21.0` (pulled only by `@prisma/config` ← prisma CLI) nor `@prisma/config` itself.
- Other measured facts: node binary 124.7 MB (unavoidable); npm+corepack ~18.7 MB (binaries are symlinks — removing via `rm` in a RUN layer does NOT shrink the image, so keep the current approach); `postgresql16-client` is only 352 KB (keep — `start.sh` uses `pg_isready`/`psql`, backups use `pg_dump`/`pg_restore`); `libphonenumber-js` 12 MB is unused (no `@IsPhoneNumber`) but a hard dep of `class-validator` — **out of scope**.

## Scope (user-selected: #1, #2, #4)

### #1 – Remove `effect` + `@prisma/config` from the api/worker runtime
- After #4 the Prisma CLI graph no longer enters the deploy output at all (structural fix). Additionally keep a defensive `rm` of `effect@*` and `@prisma+config@*` in the out-runtime cleanup so a future reintroduction fails loudly (image-size regression check in the acceptance step).

### #2 – publish.yml: zstd compression, no provenance/sbom
- In `.github/workflows/publish.yml` add to the `docker/build-push-action` step:
  - `compression: zstd` (safe — README already documents Docker Engine 24+ / Podman 5+, both zstd-capable; keeps the default level),
  - `provenance: false`,
  - `sbom: false`.
- Verified earlier: the action's tag parser uses `getList` with `skipEmptyLines: true`, so the existing conditional `:latest` line stays valid.

### #4 – Move `prisma` to devDependencies; generate the client in the build stage; standalone migration-cli stage
- Move `prisma` from `dependencies` to `devDependencies` in `apps/api/package.json` and `apps/worker/package.json` (keep `^6.19.3`), matching `packages/foundation`. Regenerate `pnpm-lock.yaml` (container pnpm, `--lockfile-only`; without `--lockfile-only` set `CI=true` — `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).
- The generated Prisma client already exists in the **build** stage (`pnpm exec prisma generate`). Copy the generated client from the build stage into the deploy output in `prod-deps` instead of generating inside the output:
  - `COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /app/prisma-generated/` then in the RUN: glob the deploy-output store dir and `cp -a /app/prisma-generated/. "$OUT_PC/.prisma/"` where `$OUT_PC` is `$(ls -d /app/out/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client | head -1)` (the store dir suffix varies by peer resolution).
  - The runtime load path must stay exactly `<store>/node_modules/.prisma/client` (client.js + `libquery_engine-linux-musl-openssl-3.0.x.so.node` 17.5 MB + `query_engine_bg.wasm` 2.3 MB).
- Worker: the old temp-symlink-for-generate step goes away; the **runtime** top-level `@prisma/client` symlink step in the runner stage stays.
- **Migration image (breaking change):** the `migration` target in `apps/api/Dockerfile` currently takes the Prisma CLI from the prod-deps deploy output. With prisma dev-only that CLI is gone. Add a standalone `migration-cli` stage: `WORKDIR /opt/migrate` + `pnpm add prisma@6.19.3 --prod` (with the shared pnpm store cache mount `versigo-pnpm-store-api`) — must run in `/opt/migrate` (NOT inside `/app`, otherwise pnpm modifies the workspace root package.json) — and have the `migration` stage `COPY --from=migration-cli /opt/migrate/node_modules ./node_modules`. The existing CMD (`node node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma`) is unchanged.
- The `migration` stage must still `COPY --chown --from=prod-deps /app/out/package.json` and `COPY --chown --from=build /app/prisma ./prisma` (schema + migrations).

## Verification
- Build all four images: `docker compose build api worker web migration` (smoke script only builds api/web/worker — the migration image must be built explicitly).
- Measure sizes (`podman images`): expect api ~340 MB, worker ~334 MB, web ~207 MB; migration image still contains the CLI (expected ~+67 MB).
- Full smoke test: `./scripts/compose-smoke-test.sh --build --clean` (31 checks incl. real API boot; it runs the migration service via `docker compose run --rm migration`).
- Gates: API vitest (654), web vitest (47), tsc, eslint, i18n guard, `docker compose config`, YAML validity of the workflow.
- Regression check for #1: `podman run --rm <api-image> sh -c 'ls node_modules/.pnpm | grep -E "effect|@prisma\+config" | wc -l'` → 0; and the Prisma client resolves at runtime (API boots + smoke test DB queries pass).

## Conventions
- German Dockerfile comments; English repo docs; existing patterns (docs layout, `.env.example`, compose smoke test).
- Required Future-Feature Contract (AGENTS.md): no new env vars/services/ports; docs updated in the same feature (`docs/docker-image-guide.md` image table, `docs/release-notes-template.md` stale "Image: Worker ~828 MB" row).
- Clean up all podman artifacts after the final verification (session images incl. `versigo-{api,worker,web,migration}` + `versigo-test`, `podman image prune -f`, `/tmp/opencode`, `df -h /var/home` afterwards).

## Out of scope
- #3 (custom `npm-slim` base image) — explicitly NOT requested by the user.
- `libphonenumber-js` / `class-validator` investigation.
- Any product feature, schema change, or workflow logic beyond the publish.yml inputs.

## Acceptance
- api/worker images drop by the expected ~31 MB each (effect + @prisma/config); measured sizes documented in the commit and docs.
- Migration image still runs `prisma migrate deploy` successfully from the standalone migration-cli stage (smoke test covers it via the migration service).
- All gates green locally (vitest, tsc, eslint, i18n, compose config, smoke test 31/31).
- Review loop: invoke the `code-reviewer` subagent (Task tool) on the uncommitted diff, write each report verbatim to `docs/reviews/BugFix-10-review-<n>.md`, fix every Critical/High/Medium (and Minor where reasonable) until **0 Critical / 0 High / 0 Medium / ≤ 8 Minor**, max 5 rounds; then commit (message starting `BugFix-10:`), rewrite `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` (next package = BugFix-10), clean up podman artifacts, verify `df -h /var/home`.
- Do **not** start any later work package.
