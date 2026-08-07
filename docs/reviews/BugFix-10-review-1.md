# BugFix-10 Review – Round 1

Date: 2026-08-07
Reviewer: code-reviewer subagent (read-only, via Task tool)
Subject: uncommitted BugFix-10 changes (Docker image size optimizations #1, #2, #4)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings

- [Minor] `apps/api/Dockerfile:127-132` — migration-cli stage omits the shared pnpm store cache mount required by the spec
  - Evidence: The work package (#4) explicitly requires the migration-cli stage to use "the shared pnpm store cache mount `versigo-pnpm-store-api`". The implemented `RUN` (lines 129–132) sets `pnpm config set store-dir /pnpm/store` but has **no** `--mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store`. This is a deviation from the spec. Impact is build-performance only (the store is written into the layer instead of a cache mount, so the migration-cli install is not cached across builds); it does not affect correctness or final image size because only `node_modules` is copied to the `migration` stage and Docker COPY materializes the hard-linked files.
  - Required fix: Add `--mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store` to the migration-cli `RUN` to match the spec and share the store cache with the api deps/prod-deps stages.

- [Minor] `apps/api/Dockerfile:132` — migration-cli resolves transitive deps fresh instead of from the repo lockfile
  - Evidence: `pnpm add prisma@6.19.3 --prod` runs in `/opt/migrate` with no `pnpm-lock.yaml`, so `@prisma/engines`, `@prisma/config`, and `effect` are resolved at build time rather than pinned to the repo's lockfile. In practice prisma@6.19.3 pins its own direct deps to exact versions, so drift risk is low, but the migration image is not reproducible from the same lockfile as the rest of the workspace. This is per-spec (the spec chose `pnpm add prisma@6.19.3 --prod`), so it is a low-risk note rather than a defect.
  - Required fix: Optional — copy the repo `pnpm-lock.yaml` into `/opt/migrate` and use `pnpm install --frozen-lockfile` (or `pnpm add --lockfile-only` first) to pin the migration image to the same dependency graph. Not blocking.

## Verified correct

- **`apps/api/package.json` / `apps/worker/package.json`**: `prisma` moved from `dependencies` to `devDependencies` (`^6.19.3`), matching `packages/foundation`. Lockfile regenerated — `apps/api` and `apps/worker` importers list `prisma` under `devDependencies` (pnpm-lock.yaml lines 117-119, 179-181); `@prisma/client` remains a runtime dependency of api/foundation.
- **Generated-client copy (api & worker prod-deps)**: `COPY --from=build .../.prisma /app/prisma-generated/` copies the `.prisma` directory contents (→ `/app/prisma-generated/client/`), then `cp -a /app/prisma-generated/. "$PRISMA_STORE_DIR/.prisma/"` places it at `<store>/node_modules/.prisma/client` — exactly the runtime load path. The `ls -d ...@prisma+client@*/node_modules | head -1` glob correctly handles the peer-resolution-dependent store suffix. The copy happens **before** `cp -a /app/out /app/out-runtime`, so the generated client is present in the runner copy.
- **Defensive effect/@prisma/config removal (#1)**: Both api and worker out-runtime cleanup remove `prisma@*`, `@prisma/engines@*`, `effect@*`, `@prisma+config@*` (api lines 107-114, worker lines 97-104), matching the spec's defensive requirement.
- **migration-cli stage (#4)**: Runs in `/opt/migrate` (not `/app`), pre-creates `package.json` + `pnpm-workspace.yaml` with `allowBuilds` for `@prisma/engines`/`prisma` (handles `ERR_PNPM_IGNORED_BUILDS`), uses `--config.auto-install-peers=false` to avoid pulling TypeScript. The `migration` stage copies `node_modules` from migration-cli, `package.json` from prod-deps, and `prisma` schema from build; CMD unchanged.
- **publish.yml (#2)**: `compression: zstd`, `provenance: false`, `sbom: false` added to `docker/build-push-action@v6` (lines 98-100) with a German comment. Valid inputs; the conditional `:latest` tag line is preserved.
- **Docs**: `docs/docker-image-guide.md` (image table 341/336/206/297 MB, before/after table, BugFix-10 explanations, section 9 inspection commands), `docs/release-notes-template.md` (metrics rows), and `docs/beta-release-checklist.md` all updated consistently. No stale size references in README.
- **No new env vars / services / ports / secrets**; migration image has no `EXPOSE`; no new network-exposed surface. Required Future-Feature Contract satisfied.
- **Compose**: `docker-compose.yml` migration service unchanged (target `migration`, same CMD); `docker-compose.dockerhub.yml` unchanged; `ci.yml` smoke job builds api/web/worker and runs migration via `docker compose run --rm migration`.

## Verification
- Tests/checks reviewed: I could not execute `git diff`/builds (no shell tool in this environment), so I verified the current working-tree state of all changed files directly: both Dockerfiles, both package.json files, pnpm-lock.yaml importer sections, publish.yml, ci.yml, docker-compose.yml, docker-compose.dockerhub.yml, docker-compose.test.yml, docker/start.sh, the smoke-test script, and the three doc files.
- Important areas inspected: generated-client store-path copy in api/worker prod-deps, migration-cli stage, migration stage node_modules sourcing, defensive effect/@prisma/config removal, publish.yml inputs, doc consistency.
- Remaining risks: The implementer's reported build sizes (api 341 / worker 336 / web 206 / migration 297 MB), the "effect/@prisma/config/prisma absent" runtime check, and the full smoke-test/gate results could not be independently re-run in this read-only review; they are consistent with the code and docs. The two Minor findings above are the only deviations from the spec.

## Severity counts
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Minor    | 2 |
