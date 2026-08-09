# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-11 (Package E)

The work package `prompts/BugFix-11-release-readiness.md` (Package E) is
implemented, reviewed (2 review rounds, acceptance condition met: 0 Critical /
0 High / 0 Medium / ≤ 8 Minor — final round 1 Minor, fixed without a further
round; see `docs/reviews/BugFix-11-review-1.md` and
`docs/reviews/BugFix-11-review-2.md`), and committed on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub` (commit `c54c557`).

Package E delivered:

1. **Upload fix (Docker images).** `apps/api/Dockerfile` and
   `apps/worker/Dockerfile` now create `/data/uploads` owned by
   `appuser:appgroup` before `USER appuser`, so fresh named volumes inherit
   correct ownership (fixes `EACCES mkdir /data/uploads/<id>`). Existing
   deployments need a one-time `podman unshare chown 100:101 <volume>/_data`
   (documented in `docs/docker-image-guide.md`). `scripts/compose-smoke-test.sh`
   extended with the upload-write probe (31 → 32 checks).
2. **Paperless API-dialect auto-negotiation.** `PaperlessNgxService` now
   negotiates `v2` (`Accept: application/json;version=2`, param `query`) vs
   `legacy` (`Accept: application/json`, param `q`) per `baseUrl`. A 406 probe
   response switches to `legacy` for all subsequent calls; 401/403 keep `v2`
   and surface the real token error; communication errors are logged, never
   thrown; failed probes are NOT cached (so a later success can flip the
   dialect). 5+ unit scenarios in `paperless-ngx.service.spec.ts`.
3. **Version 1.0.0-beta.1 everywhere + runtime exposure (B2/R7).** All five
   `package.json` files at `1.0.0-beta.1`; API/worker read `APP_VERSION`
   (optional, `'unknown'` fallback) and return it from `/health` + `/ready`
   (foundation `HealthController`); web shows `NEXT_PUBLIC_APP_VERSION` in the
   footer via the runtime-config entrypoint. Compose (`docker-compose.yml` +
   `docker-compose.dockerhub.yml`), `.env.example`, and the docs env-var tables
   updated per the Required Future-Feature Contract. The git tag
   `v1.0.0-beta.1` is created by the release manager AFTER merge (out of agent
   scope).
4. **B5 dependency audit.** bcrypt 6.0.0 (removes the
   node-pre-gyp→tar/brace-expansion graph), next 16.2.12, pnpm-workspace
   `overrides`: postcss ≥8.5.23, sharp ≥0.35.3, vite ≥6.4.3; vitest 3.2.x
   (all four manifests `^3.2.6`, lockfile resolves 3.2.7). `pnpm audit --prod`
   = 0 advisories (0/0/0); 5 remaining HIGH are Dev-Tooling only, documented
   with reason + risk in checklist R-12.
5. **R1 rename + German→English translation round.** README/CONTRIBUTING/
   SECURITY use `M0P/VersiGo`; `git remote set-url origin
   https://github.com/M0P/VersiGo.git` is local-only (describe in PR). All
   code comments/JSDoc/non-UI runtime strings in `apps/*/src/**`, Dockerfiles,
   `docker/*.sh`, and `.github/workflows/*.yml` are now English; specs updated
   to the new assertion strings. German remains ONLY in the documented
   allowlist: i18n UI resources (`apps/web` locale files), user-visible UI
   labels (settings-catalog descriptions, admin-settings validation messages,
   Wüstenrot portal label in `portal-catalog.ts:132,135`, spec fixtures), and
   the functional German LLM prompts in
   `apps/worker/src/ai-extraction.processor.ts` (all four, now explicitly
   commented as intentional allowlist entries — German summaries are a
   feature).
6. **B3 advanced-security diagnosis.** The `github-advanced-security` failure
   is a GitHub default-setup run, not a repo workflow; state and owner actions
   documented in the commit/PR (no repo-admin rights were used).
7. **R5 release notes.** `docs/release-notes-v1.0.0-beta.1.md` is concrete;
   `docs/beta-release-checklist.md` updated (version row, R-12 audit numbers,
   test counts 660/58/47/4/107, vitest 3.2.x wording); `docs/release-guide.md`
   references the concrete notes file.
8. **R6 repo hygiene.** Stale untracked
   `prompts/BugFix-03-post-bugfix02-issues.md` deleted; local merged branches
   pruned; remote branch cleanup left for the owner (listed in the commit).

**Security note for reviewers of this commit:** during the translation round
the `@IsUrl({ protocols: ['http','https'], require_protocol: true })`
decorators on `CreatePortalAccountLinkDto.portalUrl` and
`UpdatePortalAccountLinkDto.portalUrl` (`apps/api/src/features/policy-registry/
dto/policy-registry.dto.ts`) had been accidentally dropped; they were restored
to match HEAD. Verify they stay present in future edits of that file — the
DTO tests (`policy-registry.dto.spec.ts:66-69,138-142,166-168`) cover it.

## Verification state of the BugFix-11 commit

- Full compose test gate (container): `pnpm run test` 5/5 tasks (API 58 files /
  660 tests, web 47, foundation 107, worker 4), `pnpm run typecheck` 4/4,
  `pnpm run lint` 3/3, i18n guard OK (no hardcoded German UI texts in 54 files).
- Compose smoke test (`--build`): 32/32 checks (incl. new upload-write probe).
- Live dev-stack checks performed earlier in the package: end-to-end upload
  E2E OK, `/health` + `/ready` return `version`.
- Review loop: 2 rounds, acceptance met 0/0/0/1 (round 1: 0/0/0/3; round 2:
  0/0/0/1, fixed immediately; no round 3 needed).

## No next work package exists

`prompts/` contains no further numbered work package after BugFix-11 (the
last file is `prompts/BugFix-11-release-readiness.md`). All currently defined
work packages are committed (AP-01 … AP-21, BugFix-01 … BugFix-11).

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
  rebuilds: always `docker compose ... down` (or `down -v`) before `up`; the
  smoke script supports `--clean`. The test runner service has NO volume mount
  — source is baked into the image at build time, so any verification of
  host-side edits requires rebuilding the test image
  (`docker compose -f docker-compose.test.yml build test`).
- `docker-compose.test.yml` sets `name: versigo`, which collides with the dev
  stack project name: `docker compose -f docker-compose.test.yml down -v`
  tries to remove the dev network `versigo_versigo-internal` and errors.
  Workaround: run `down` (drop `-v`) or remove test containers manually.
- Node/pnpm are NOT on the host PATH; run gates via the test container.
- The `auth.service.ts ↔ oidc.strategy.ts` cycle is load-order fragile: a
  full API boot (real Nest bootstrap) is the ONLY check that proves it; the
  unit suites cannot.
- Disk on `/var/home` is ~123 GB and fills quickly; `podman system prune -a -f`
  before large rebuilds. Never redirect podman storage. Clean up all podman
  artifacts created during a session before the commit and verify
  `df -h /var/home` afterwards.
