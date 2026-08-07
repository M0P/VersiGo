# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-10 (Package D)

The work package `prompts/BugFix-10-docker-image-size-optimizations.md`
(Package D) is implemented, reviewed (4 review rounds, acceptance condition
met: 0 Critical / 0 High / 0 Medium / 0 Minor), and committed on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub` (commit `c654e13`, see
`docs/reviews/BugFix-10-review-1.md` through `-4.md`).

Package D delivered (user-selected scope #1, #2, #4; #3 custom base image and
libphonenumber-js are out of scope):

1. **#4 – Prisma CLI out of the runtime images.** `prisma` moved from
   `dependencies` to `devDependencies` in `apps/api/package.json` and
   `apps/worker/package.json` (foundation already had it there); lockfile
   regenerated. The generated Prisma client is now created once in the
   Dockerfile `build` stage (`prisma generate`) and copied into the deploy
   output's store path
   (`.pnpm/@prisma+client@*/node_modules/.prisma/client` — the only path the
   client loads at runtime) instead of running `prisma generate` inside the
   prod-deps stage. A standalone `migration-cli` stage (`pnpm add prisma@6.19.3
   --prod --config.auto-install-peers=false` in `/opt/migrate`, with a
   `pnpm-workspace.yaml` allowBuilds pre-file to satisfy pnpm 11's
   `ERR_PNPM_IGNORED_BUILDS`) provides the CLI for the `migration` target;
   the migration stage copies `node_modules` from it. The shared store cache
   mount `versigo-pnpm-store-api` is used. Dead `COPY --from=build
   /app/prisma ./prisma` lines in the prod-deps stages were removed.
2. **#1 – Defensive cleanup.** The out-runtime copy in both Dockerfiles
   additionally removes `effect@*` and `@prisma+config@*` (only pulled by the
   Prisma CLI graph), so a future reintroduction fails the size/LEAK review
   instead of silently growing the images.
3. **#2 – Publish workflow.** `.github/workflows/publish.yml` now uses
   `compression: zstd`, `provenance: false`, `sbom: false` for the
   `docker/build-push-action@v6` Docker Hub push.
4. **Measured image sizes (BugFix-10, final):** api ~339 MB, worker ~333 MB,
   web ~206 MB, migration ~297 MB (down from 371/365/207/431 MB in BugFix-07).
   Documented in `docs/docker-image-guide.md` (v1.4.0),
   `docs/release-notes-template.md`, `docs/beta-release-checklist.md`
   (rows 2/3, R-08).

## Verification state of the BugFix-10 commit

- All four images built: api 339 MB, worker 333 MB, web 206 MB, migration
  297 MB.
- Runtime invariants verified in api+worker images: LEAK check OK (no
  eslint/vitest/@nestjs+cli/prisma/effect/@prisma+config); generated Prisma
  client 20.5 MB present at the runtime store path.
- `prisma migrate deploy` applied all migrations against a live PostgreSQL
  from the migration image (prisma 6.19.3); api/worker boot healthy
  (`/health` 200, compose healthchecks green).
- Compose smoke test (`--clean`): all 31 checks PASS (incl. real Nest boot in
  dev AND production paths, worker, BullMQ round-trip).
- Compose test gate green earlier on identical runtime code: API vitest
  654/654, web 47/47, foundation 105/105, worker 4/4, typecheck, lint, i18n
  guard (54 files), `prisma migrate deploy`, both compose configs valid,
  publish.yml YAML valid.
- Review loop: 4 rounds, acceptance met 0/0/0/0 (rounds 1/2/3/4 findings:
  2 Minor → 0 → 1 Minor → 0).

## No next work package exists

`prompts/` contains no further numbered work package after BugFix-10 (the
last files are `AP-21-multi-language-support.md` and
`BugFix-10-docker-image-size-optimizations.md`). All currently defined work
packages are committed (BugFix-01 … BugFix-10, AP-01 … AP-21).
Note: `prompts/BugFix-03-post-bugfix02-issues.md` exists as an UNTRACKED file
(pre-existing from an earlier session, not part of any committed package) —
do not commit or implement it unless the user explicitly asks.

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/`, implement only that one and use the same
review loop (invoke the `code-reviewer` subagent via the Task tool on the
uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor,
max 5 rounds, then commit with a message starting with the package number and
write a new handoff).

## Environment reminders for the next session (Podman host)

- `docker` is a Podman shim → podman-compose. Reuse stale containers after
  rebuilds: always `docker compose ... down -v` (or `down`) before `up`; the
  smoke script supports `--clean`.
- Node/pnpm are NOT on the host PATH; run gates via
  `podman run --rm -v <repo>:/work -w /work node:24-alpine` with direct
  binary paths (e.g. `node /work/apps/api/node_modules/vitest/vitest.mjs run`).
- The `auth.service.ts ↔ oidc.strategy.ts` cycle is load-order fragile: a
  full API boot (real Nest bootstrap) is the ONLY check that proves it; the
  unit suites cannot.
- Disk on `/var/home` is ~123 GB and fills quickly; `podman system prune -a -f`
  before large rebuilds. Never redirect podman storage. Clean up all podman
  artifacts created during a session before the commit and verify
  `df -h /var/home` afterwards.
