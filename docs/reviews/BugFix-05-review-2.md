# BugFix-05 Review 2 (finding #9: Docker production build fix)

> Review result reproduced verbatim from the `code-reviewer` subagent invocation
> (task `ses_034001410ffeyrPCd71UefH9Jg`), 2026-08-04.

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Findings
- No findings.

Both round-1 Minor findings are verified as resolved:

**Round-1 Minor #1 (doc line 157) — resolved.**
`prompts/BugFix-05-feature-config-portal-url-costs-spinner.md:157` now reads: "…in allen Stufen, die einen Store nutzen (bei api/worker: deps- und prod-deps-Stage; bei web: deps- und build-Stage)…". This matches the code exactly: `apps/api/Dockerfile:26` (deps) + `:68` (prod-deps), `apps/worker/Dockerfile:26` (deps) + `:66` (prod-deps), `apps/web/Dockerfile:20` (deps) + `:35` (build). The sentence no longer over-generalizes across the three files.

**Round-1 Minor #2 (unguarded COPYs) — resolved (documented, no code defect).**
`apps/api/Dockerfile:39-40` and `apps/worker/Dockerfile:39-40` now append the invariant comment: "Invariante: beide Verzeichnisse werden vom deps-Install immer materialisiert (api/worker und foundation haben Dependencies); die COPYs sind unguarded." I verified the invariant is factually true in the current tree: `packages/foundation/package.json` declares real deps (`zod`, `@nestjs/common`, `@nestjs/bullmq`, `bullmq`, `ioredis`, `@prisma/client`), and `apps/api/package.json`/`apps/worker/package.json` both declare substantial dependency sets (including `@versigo/foundation: workspace:*`). With `--prod=false` in the deps-stage filtered install, both per-package `node_modules` directories are always materialized, so the unconditional `COPY --from=deps` lines cannot fail under the current dependency graph.

## Verification
- **Round-1 doc**: `docs/reviews/BugFix-05-review-1.md` exists and reproduces the round-1 review verbatim (2 Minor findings, summary line, required fixes); the line citations (e.g. `apps/web/Dockerfile:35`, doc `:157`) match the state at round-1 time.
- **apps/api/Dockerfile**: per-package `node_modules` copied from `deps` (`apps/api/node_modules`, `packages/foundation/node_modules`) at lines 42–43, before the source overlays (`COPY apps/api ./apps/api` at :49, `COPY packages/foundation` at :50) — Docker `COPY` merges without deleting, so `node_modules` survives the overlay; `.dockerignore` excludes host `node_modules`. Cache-mount id `versigo-pnpm-store-api` used in deps (:26) and prod-deps (:68).
- **apps/worker/Dockerfile**: identical pattern with `apps/worker` (:42) and `versigo-pnpm-store-worker` (:26, :66), including the worker-specific `@prisma/client` symlink handling in the runner stage.
- **apps/web/Dockerfile**: cache-mount id `versigo-pnpm-store-web` in deps (:20) and build (:35); no per-package copies needed (no foundation dep, unfiltered root install) — consistent with doc :152.
- **Cache-id scope**: repo-wide grep confirms the three service Dockerfiles use only `-api`/`-worker`/`-web` ids; the shared `versigo-pnpm-store` remains only in `Dockerfile`/`Dockerfile.test`, which are separate build contexts/jobs and non-conflicting (verified in round 1).
- **Required Future-Feature Contract**: the change introduces no new runtime dependency, env var, migration, queue, port, or service — no Compose/`.env.example`/smoke-test updates required.
- **Remaining risk (unchanged from round 1)**: verification was performed on podman-compose; the first GitHub Actions (BuildKit) run after merge is the final confirmation, but the store-sharing race is structurally removed, so no CI-side blocker is expected.

## Summary line
0 Critical, 0 High, 0 Medium, 0 Minor findings.

**Verdict: PASS** — acceptance condition met (0 Critical / 0 High / 0 Medium / ≤ 8 Minor).
