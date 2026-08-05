# BugFix-05 Review 1 (finding #9: Docker production build fix)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_0340569c8ffeKXbEtozCsuO5ss`), 2026-08-04.

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings

- [Minor] `prompts/BugFix-05-feature-config-portal-url-costs-spinner.md:157` — work-package doc says each service Dockerfile uses its own cache-mount id "in deps- und prod-deps-Stage", but `apps/web/Dockerfile` has **no** prod-deps stage; its second `versigo-pnpm-store-web` mount is in the **build** stage (`apps/web/Dockerfile:35`). The statement is exactly true only for api/worker.
  - Evidence: `apps/web/Dockerfile` has only `deps` (line 20) and `build` (line 35) stages; api has `deps` (26) + `prod-deps` (66), worker has `deps` (26) + `prod-deps` (64). The sentence over-generalizes across all three files.
  - Required fix: reword line 157 to "in deps- und prod-deps-Stage (bzw. Build-Stage bei web)" or "in allen Stufen, die einen Store nutzen", so the documentation matches the code.

- [Minor] `apps/worker/Dockerfile:40-41` and `apps/api/Dockerfile:40-41` — the new `COPY --from=deps /app/apps/<app>/node_modules …` and `COPY --from=deps /app/packages/foundation/node_modules …` lines are unconditional. If a future dependency change ever leaves a package with no installed deps (no `node_modules` materialized by pnpm), the `COPY --from=deps` of a non-existent path fails the whole image build hard.
  - Evidence: pnpm currently always creates these directories (both packages have deps: foundation needs `zod`/`@nestjs/common`/…, api/worker have large dep sets, verified in the package.json files), so there is no current defect — this is a robustness/maintainability note only.
  - Required fix: none needed now; optionally document the invariant ("deps stage must always materialize both node_modules dirs") in the comment block, or guard with `--from=deps` only if the directory exists.

## Verification

Files inspected: `apps/worker/Dockerfile`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `Dockerfile`, `Dockerfile.test`, `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.test.yml`, `.github/workflows/ci.yml`, `.dockerignore`, `pnpm-workspace.yaml`, root/apps/foundation `package.json`, worker/api/foundation `tsconfig*.json`, `scripts/compose-smoke-test.sh` (head), and the full finding #9 section of the work-package doc (lines 139–159, 197, 220).

- **COPY correctness/ordering**: the per-package `node_modules` are copied from `deps` before the source overlays (`COPY apps/<app> ./apps/<app>`, `COPY packages/foundation ./packages/foundation`). Docker `COPY` merges and never deletes existing destination files, so `node_modules` survives the overlay. The build context cannot contaminate the overlay: `.dockerignore:2` excludes `node_modules/` (matches nested dirs), and CI uses a fresh checkout with no host `node_modules`.
- **Resolution completeness**: worker/api tsc resolves foundation sources inline via `paths` (`apps/worker/tsconfig.json:19`) and needs `packages/foundation/node_modules` for foundation's own deps (`zod`, `@nestjs/common`, `@nestjs/bullmq`, `ioredis` — exactly the TS2307 modules named in the CI log); both per-package dirs are now carried, and the pnpm virtual store lives in the already-copied root `node_modules/.pnpm`. The fix therefore makes the build independent of any pnpm hoisting behavior.
- **Cache-mount ids**: grep over the whole repo shows only `-api`/`-worker`/`-web` ids in the three service Dockerfiles (deps + prod-deps/build) and no leftover shared `versigo-pnpm-store` there. `Dockerfile`/`Dockerfile.test` still use the shared id, which is correct and non-conflicting: in CI the test image (`compose-test` job) and the three service images (`compose-smoke` job) are built in separate jobs/invocations, and `docker compose build api web worker` (`ci.yml:64`, `build-metrics` at `ci.yml:216`) only builds the service Dockerfiles.
- **Security**: no new exposure. The build-stage `node_modules` come from the registry-installed `deps` stage, not the host context; `.dockerignore` excludes `.env*` and `node_modules`; the runner stages still receive only `pnpm deploy --prod` output. Dev-only tooling remains confined to intermediate build stages.
- **Documentation**: finding #9's Ist-Zustand/root-cause/Erwartung (doc lines 139–159, 220) is accurate and consistent with the code changes, including the claim that web has no `@versigo/foundation` dependency (verified) and uses an unfiltered install.
- **Comments**: the German comment blocks (worker 23–25/32–38, api 23–25/32–38, web 17–19) are accurate, helpful, and consistent; api/worker duplication is acceptable and in sync for a per-service Dockerfile layout.
- **Tests/checks**: no automated test covers Dockerfile internals; the implementer-reported gates (`docker compose build --no-cache worker api web` cold, full `docker-compose.test.yml` gate, `compose-smoke-test.sh --build`) are trusted per instructions and reproduce the CI scenario (parallel cold builds). Remaining risk: verification was on podman-compose; per AGENTS.md note 1 the CI (BuildKit on ubuntu-latest) container/image reuse behavior differs, so the first CI run after merge is the final confirmation — but the fix removes the store-sharing race entirely, so no CI-side blocker is expected.

## Summary line
0 Critical, 0 High, 0 Medium, 2 Minor findings.
