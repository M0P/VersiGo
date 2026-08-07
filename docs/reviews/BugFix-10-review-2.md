# BugFix-10 Review – Round 2

Date: 2026-08-07
Reviewer: code-reviewer subagent (read-only, via Task tool)
Subject: BugFix-10 diff after round-1 fixes (cache mount restored; lockfile decision documented)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Findings
- No findings.

## Verified correct

**Round-1 finding #1 (cache mount) — FIXED.** `apps/api/Dockerfile:136` now includes `--mount=type=cache,id=versigo-pnpm-store-api,target=/pnpm/store` on the migration-cli `RUN`, matching the spec (#4) and the deps/prod-deps stages. The `pnpm config set store-dir /pnpm/store` inside the RUN is consistent with the mount target, so the store is cached across builds. The mount ID is identical to the api stages (deps/prod-deps), which is correct — the migration-cli stage lives in the same `apps/api/Dockerfile` and is only built when the `migration` target is requested, so it does not collide with the worker/web store IDs (`versigo-pnpm-store-worker`).

**Round-1 finding #2 (lockfile reproducibility) — DOCUMENTED.** `apps/api/Dockerfile:127-131` now carries a clear German comment explaining that `pnpm add prisma@6.19.3` resolves transitives without a lockfile, that prisma@6.19.3 pins its direct deps (`@prisma/*`) to exact versions, and that a second lockfile root is the higher maintenance cost for a one-shot tool image. This is a per-spec accepted trade-off; the documentation is accurate and appropriately placed above the stage.

**No new issues introduced by the fixes.** The added cache mount and comment do not alter the migration stage's `COPY --from=migration-cli /opt/migrate/node_modules ./node_modules` (line 153), the unchanged CMD (line 161), or the `migration` stage's package.json/schema sourcing (lines 154-155). The migration image still gets the CLI from the standalone stage; the runner images remain CLI-free.

**Scope conformance (#1, #2, #4):**
- #1 — Defensive `effect@*` / `@prisma+config@*` removal present in both api (`apps/api/Dockerfile:107-114`) and worker (`apps/worker/Dockerfile:97-104`) out-runtime cleanup.
- #2 — `publish.yml:98-100` has `compression: zstd`, `provenance: false`, `sbom: false` with a German comment; the conditional `:latest` tag line (line 103) is preserved.
- #4 — `prisma` moved to `devDependencies` in `apps/api/package.json:38` and `apps/worker/package.json:25` (`^6.19.3`), matching `packages/foundation`; lockfile importers confirm `prisma` under `devDependencies` (pnpm-lock.yaml lines 117-119, 179-181) with `@prisma/client` remaining a runtime dep of api/foundation. Generated-client copy from build stage into the deploy store path is correct in both Dockerfiles (api lines 82/94-96, worker lines 75/89-91). The worker runtime top-level `@prisma/client` symlink (worker lines 136-137) is retained.

**Docs & conventions:** `docs/docker-image-guide.md` (image table 341/336/206/297 MB, before/after, BugFix-10 explanations, section 9 inspection commands) and `docs/release-notes-template.md` (metrics rows) are consistent with the code and the implementer's measured sizes. No new env vars/services/ports/secrets; the migration image has no `EXPOSE`; `docker-compose.yml` migration service unchanged; `ci.yml` and the smoke script run the migration via `docker compose run --rm migration` (which builds the `migration` target on demand).

## Verification
- **Tests/checks reviewed:** I could not execute `git diff`/builds (no shell tool in this read-only environment), so I verified the current working-tree state of all changed files directly: both Dockerfiles, both package.json files, pnpm-lock.yaml importer sections, publish.yml, ci.yml, docker-compose.yml, the smoke-test script, and the two doc files.
- **Important areas inspected:** migration-cli cache mount + documentation comment, migration stage node_modules/package.json/schema sourcing, defensive effect/@prisma/config removal in api/worker, publish.yml inputs, doc size consistency.
- **Remaining risks:** (1) The migration-cli stage shares the `versigo-pnpm-store-api` cache ID with the api deps/prod-deps stages; BuildKit may build these independent stages in parallel within a single Dockerfile. This is per-spec and pre-existing (deps/prod-deps already shared the ID), and the implementer verified `docker compose build migration` succeeds, so it is a low-probability note rather than a defect. (2) The implementer's reported build sizes, the "effect/@prisma/config/prisma absent" runtime check, and the full smoke-test/gate results could not be independently re-run here; they are consistent with the code and docs.

## Severity counts
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Minor    | 0 |
