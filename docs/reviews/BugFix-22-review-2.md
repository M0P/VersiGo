# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

## Findings

- [Minor] `apps/api/vitest.config.ts:5-6` — comment still claims host `dist` directories are part of the Docker build context, which the same work package now contradicts
  - Evidence: the comment justifies the explicit `include` with "…if a build ever leaves them in `dist` (host per-app `dist` directories are part of the Docker build context)". The delta in this same package adds `dist/`, `**/dist/`, `.next/`, `**/.next/`, `*.tsbuildinfo`, `**/*.tsbuildinfo` to `.dockerignore`, so host `apps/*/dist` is **no longer** part of the build context (verified: all dist/.next consumers are `COPY --from=build …`, and every compose build context is the repo root, so the single root `.dockerignore` applies — there are no per-app `.dockerignore` files). Additionally, `apps/api` builds with `tsconfig.build.json`, which excludes `**/__tests__/**` and `**/*.spec.ts` (verified), so an in-image `apps/api/dist` can never contain specs either. The retained mechanism therefore no longer exists for `apps/api`, and the round-1 follow-up ("mention the real foundation case" — `packages/foundation/tsconfig.json` includes all of `src`, so its `dist` genuinely does contain compiled specs) was not carried into this file.
  - Why it matters: a stale/incorrect rationale in a config touched by this package can mislead the next maintainer into believing host `dist` still flows into the image (it does not), and obscures the one package (`foundation`) where the guard is load-bearing.
  - Required fix: reword the `apps/api/vitest.config.ts` header comment to state only that the `include` is defensive/consistency-only for `apps/api` (its `tsconfig.build.json` excludes tests) and point to `packages/foundation` as the package where compiled specs in `dist` are actually possible; do not assert that host `dist` directories enter the Docker build context.

Nothing else in the delta is defective: the depth-agnostic ignores are safe (no `COPY .`/`ADD`, no context-sourced `dist`/`.next`/`tsbuildinfo`, no per-app `.dockerignore`), the two `vitest.config.ts` files behave as before (same `environment`/`include`; no `*.test.*` files exist in `apps/api` or `packages/foundation`, so the narrowed `include` drops no tests — 62 api specs and 12 foundation specs match the reported gate counts), and both round-1 Minors are applied as described.

## Verification
Checked (read-only static inspection; no shell available in this session):
- `.dockerignore` full content: `**/dist/`, `**/.next/`, `**/*.tsbuildinfo` present alongside `dist/`, `.next/`, `*.tsbuildinfo`; `docs/*` + `!docs/third-party-notices.md` exception intact.
- Every `dist`/`.next`/`tsbuildinfo` reference in `Dockerfile`, `Dockerfile.test`, `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile` — all are `COPY --from=build …` / `--from=prod-deps …` / in-stage build output, never from the build context.
- All compose build contexts (`docker-compose.yml`, `docker-compose.test.yml`) are `context: .`; `glob **/.dockerignore` returns only the root file; no compose file references `dist`/`.next`/tsbuildinfo (no bind mounts that could depend on them).
- No `COPY .` / `ADD .` wildcard context copies exist.
- `apps/api/vitest.config.ts`, `packages/foundation/vitest.config.ts` (comments converted to `//`, no `*/` sequence left), `apps/worker/vitest.config.ts`, `apps/web/vitest.config.ts` (unchanged baseline); `apps/api/package.json` build = `tsc -p tsconfig.build.json`; `packages/foundation/package.json` build = `tsc -p tsconfig.json` and its `tsconfig.json` includes all of `src`.
- Spec inventory: all `apps/api` (62) and `packages/foundation` (12) specs live under `src/**` and match the new `include`; no `*.test.*` files exist in either package; `apps/web` has 8 specs including the new `src/__tests__/costs-overview-card-submit.spec.ts`.
- Task A surface (unchanged by the delta, spot-checked): both submit chains (`costs-overview-card.tsx:189-196`, `258-262`) clear `setSubmitting(false)` unconditionally in `.finally`, while success/error data writes remain seq-guarded; new regression guard exists with a guard-the-guard case.
- Round-1 artifact `docs/reviews/BugFix-22-review-1.md`: both reported Minors correspond to the delta applied in this tree.

Could not verify (no shell/bash tool in this session, and per instructions no builds were run):
- I could not run `git diff` / `git status`, so the delta was confirmed by reading the current file contents against the round-1 report rather than against a diff.
- I could not independently re-run the Docker gate or inspect the container/image; the green-gate evidence ("All checks passed!", api 62/755, web 8/115, worker 4/48, foundation 12/107) is taken from the work package and round-1 record, not reproduced here.

Remaining risks (pre-existing, not introduced by this delta, no action required for this package): `.env.test` and `.env.test-manual` are not covered by `.dockerignore` (only `.env`, `.env.local`, `.env.*.local` are). No current Dockerfile copies them into an image, so there is no exposure today; it is only a hazard if a future `COPY . .` is added.

## Reviewer metadata
- Subagent name: review (round 2, confirmation review of `fix/cost-entry-save-button`, HEAD 1112a6d work tree)
- Model string: `opencode/deepseek-v4.1-flash-free`
- Round: 2
