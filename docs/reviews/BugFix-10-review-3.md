# BugFix-10 Review – Round 3

Date: 2026-08-07
Reviewer: code-reviewer subagent (read-only, via Task tool)
Subject: BugFix-10 final diff after round-2 cleanup (dead schema COPY removed; doc sizes updated to 339/333/206/297 MB)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

## Findings

- [Minor] `apps/api/Dockerfile:66-68` — stale comment claims the deploy output includes the Prisma CLI
  - Evidence: The prod-deps stage comment reads "`pnpm deploy` erzeugt ein eigenstaendiges Verzeichnis mit den Produktions-Dependencies des Projekts (inkl. gepacktem @versigo/foundation **und Prisma-CLI**)". This directly contradicts BugFix-10 #4, which moved `prisma` to `devDependencies` so the CLI graph is no longer in the deploy output (the whole point of the package). The comment is a leftover from the pre-BugFix-10 state and is now factually wrong. The worker Dockerfile does not repeat this claim (it only references the api Dockerfile), so only the api file is affected.
  - Required fix: Remove "und Prisma-CLI" from the parenthetical (or reword to "inkl. gepacktem @versigo/foundation und generiertem @prisma/client"), so the comment matches the actual deploy output.

## Verified correct

- **Dead-COPY removal is safe in both Dockerfiles.** Neither `apps/api/Dockerfile` nor `apps/worker/Dockerfile` prod-deps stage contains `COPY --from=build /app/prisma ./prisma` anymore. The prod-deps `RUN` in both files references only `/app/out`, `/app/prisma-generated`, and `/app/out-runtime` — no `/app/prisma` path. The migration stage (`apps/api/Dockerfile:153`) and both runner stages (`apps/api/Dockerfile:182`, `apps/worker/Dockerfile:123`) still copy the schema directly from the `build` stage, so the schema/migrations remain available where needed. The removal is correct and complete.
- **Comments above remaining COPYs adjusted.** The prod-deps comments now describe the foundation copy and the generated-client copy (`/app/prisma-generated/`) accurately in both Dockerfiles.
- **Docs size consistency.** `docs/docker-image-guide.md` (image table lines 16-19 and before/after table lines 25-28), `docs/release-notes-template.md` (metrics rows 94-97), and `docs/beta-release-checklist.md` (rows 2/3 lines 15-16, R-08 line 64) all use api 339 / worker 333 / web 206 / migration 297 MB. No leftover 341/336 references in current docs (the only 341/336 hits are in the historical review files `docs/reviews/BugFix-10-review-1.md`/`-2.md`, which are records of prior rounds, not live docs).
- **Scope conformance (#1, #2, #4).** Defensive `effect@*`/`@prisma+config@*` removal present in both api and worker out-runtime cleanup; `publish.yml` zstd/provenance/sbom inputs; `prisma` as devDependency with generated client copied from build stage; standalone `migration-cli` stage with the shared store cache mount. All consistent with the work package.
- **Conventions.** German Dockerfile comments (except the one stale line above), English repo docs, no new env vars/services/ports/secrets — Required Future-Feature Contract satisfied.

## Verification
- **Tests/checks reviewed:** I could not execute `git diff`/builds (no shell tool in this read-only environment), so I verified the current working-tree state of all changed files directly: both Dockerfiles, the root `Dockerfile` (web), `docs/docker-image-guide.md`, `docs/release-notes-template.md`, `docs/beta-release-checklist.md`, and the two prior review files. I grepped for stale size references (341/336/828/839/493/487/371/365/431) and for `/app/prisma` usage across all Dockerfiles.
- **Important areas inspected:** prod-deps stage COPY/RUN in api+worker (dead-COPY removal), migration-stage and runner-stage schema sourcing, doc size tables, defensive cleanup lists, migration-cli stage.
- **Remaining risks:** The implementer's reported build sizes (339/333/206/297 MB), the LEAK check, the migration run against live PostgreSQL, and the full smoke/gate results could not be independently re-run here; they are consistent with the code and docs. The one Minor finding above is the only deviation.

## Severity counts
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Minor    | 1 |
