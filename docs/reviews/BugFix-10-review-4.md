# BugFix-10 Review – Round 4 (final)

Date: 2026-08-07
Reviewer: code-reviewer subagent (read-only, via Task tool)
Subject: BugFix-10 final diff after round-3 comment fix

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Findings
- No findings.

## Verified correct

1. **`apps/api/Dockerfile` prod-deps comment (R3 fix) — resolved.** Lines 66-71 now read "(inkl. gepacktem @versigo/foundation und generiertem @prisma/client; die Prisma-CLI ist devOnly seit BugFix-10 #4 und fehlt im Deploy-Output). Hinweis: `pnpm install --prod` verlinkt in pnpm 11.17.0 keine Top-Level-Pakete (Regression), daher deploy statt install." This matches the stated fix exactly and no longer claims the Prisma CLI is in the deploy output. No other stale claims in the file: the header (lines 6-18), prod-deps RUN comments (87-114), migration-cli stage (116-140), migration stage (142-161), and runner stage (163-198) all consistently describe the devOnly CLI, the generated client copied from the build stage, and the standalone `migration-cli` stage.

2. **`apps/worker/Dockerfile` — no stale claims.** Header (6-15) and prod-deps comment (62-64, referencing the api Dockerfile) are accurate; no claim that the Prisma CLI is in the deploy output. The runner-stage top-level `@prisma/client` symlink (134-135) is correctly documented.

3. **`.github/workflows/publish.yml` (#2) — present.** Lines 98-100 set `compression: zstd`, `provenance: false`, `sbom: false`, with an accurate explanatory comment (94-97).

4. **`apps/api/package.json` + `apps/worker/package.json` (#4) — `prisma` in devDependencies.** api line 38 (`"prisma": "^6.19.3"`), worker line 25 (`"prisma": "^6.19.3"`); `@prisma/client` remains a runtime dependency in api (line 21). Matches the work package.

5. **Docs size consistency (339/333/206/297 MB).** `docs/docker-image-guide.md` (image table lines 16-19, before/after table lines 25-28), `docs/release-notes-template.md` (metrics rows 94-97), and `docs/beta-release-checklist.md` (rows 2/3 lines 15-16, R-08 line 64) all use api 339 / worker 333 / web 206 / migration 297 MB. No leftover stale references in these live docs (the only 341/336/828 hits are in historical review files and the historical AP-20 `PR_DESCRIPTION.md`, which are records of prior rounds, not live docs).

6. **Work package scope (#1, #2, #4) fully implemented.** Defensive `effect@*`/`@prisma+config@*` removal present in both api and worker out-runtime cleanup (#1); publish.yml zstd/provenance/sbom (#2); `prisma` as devDependency with generated client copied from build stage and standalone `migration-cli` stage with the shared store cache mount (#4). All consistent with the work package.

## Verification
- **Tests/checks reviewed:** Read-only inspection of the current working-tree state of `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `.github/workflows/publish.yml`, `apps/api/package.json`, `apps/worker/package.json`, `docs/docker-image-guide.md`, `docs/release-notes-template.md`, `docs/beta-release-checklist.md`, the work package prompt, and prior review records. Grepped for stale size references (341/336/828/839/493/487/371/365/431) and for the Prisma-CLI-in-deploy-output claim.
- **Important areas inspected:** prod-deps comment accuracy, worker Dockerfile claims, publish.yml zstd/provenance/sbom inputs, prisma devDependency placement, doc size tables, defensive cleanup lists, migration-cli stage.
- **Remaining risks:** The implementer's reported build sizes (339/333/206/297 MB), the LEAK check, the migration run against live PostgreSQL, and the full smoke/gate results could not be independently re-run in this read-only environment; they are consistent with the code and docs. The `PR_DESCRIPTION.md` (AP-20 historical record) still shows pre-BugFix-10 sizes but is out of scope for this work package.

## Severity counts
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Minor    | 0 |
