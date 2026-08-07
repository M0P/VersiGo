# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-09 (Package C)

The work package `prompts/BugFix-09-ci-fix-community-standards-dockerhub.md`
(Package C) is implemented, reviewed (2 review rounds, acceptance condition
met: 0 Critical / 0 High / 0 Medium / 0 Minor), and committed on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub` (commit `e97eb95`, see
`docs/reviews/BugFix-09-review-1.md` and `docs/reviews/BugFix-09-review-2.md`).

Package C delivered:

1. **CI fix** — the GitHub "API not healthy" failure was a pre-existing
   BugFix-07 regression: a module-evaluation-time circular import
   (`auth.service.ts` -> `./oidc.strategy`) made Nest DI capture `undefined`
   for `AuthService` in `OidcStrategy` at boot. Fixed by replacing the
   top-level import of `normalizeIssuerUrl` in `auth.service.ts` with a lazy
   `await import('./oidc.strategy')` inside the using method (the
   `oidc.strategy -> auth.service` VALUE import is untouched, preserving
   `design:paramtypes`). Regression guard: the CI health step boots the API
   and hits `/health`; the compose smoke test proves a real Nest bootstrap in
   dev and production paths.
2. **Community standards** — `LICENSE` (AGPL-3.0, user-decided), `CODE_OF_CONDUCT.md`
   (Contributor Covenant 2.1), `CONTRIBUTING.md`, `SECURITY.md` (GitHub
   Security Advisories only, user-decided), `.github/ISSUE_TEMPLATE/`
   (`bug_report.yml`, `feature_request.yml`, `config.yml`),
   `.github/pull_request_template.md`.
3. **Docker Hub publishing** — `.github/workflows/publish.yml` builds a matrix
   of api / worker / web / migration and pushes `m000p/versigo-<service>`
   (user-decided namespace) as `<version>` + `:latest` on tag `v*`, or
   `manual-<short-sha>` (no `:latest`) on `workflow_dispatch`. ghcr.io removed
   (user-decided Docker Hub only). New `docker-compose.dockerhub.yml` deploys
   the stack from the prebuilt images with no build.
4. **README** — fully translated to English, warning box preserved with
   equivalent meaning, quick start deploys from Docker Hub images without
   rebuilding. `docs/docker-image-guide.md`, `docs/release-guide.md` and
   `docs/release-notes-template.md` updated; `.env.example` documents
   `VERSIGO_IMAGE_TAG`.

## No next work package exists

`prompts/` contains no further numbered work package after BugFix-09
(the last files are `AP-21-multi-language-support.md` and
`BugFix-09-ci-fix-community-standards-dockerhub.md`). All currently defined
work packages are committed (BugFix-01 … BugFix-09, AP-01 … AP-21).

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/`, implement only that one and use the same
review loop (invoke the `code-reviewer` subagent via the Task tool on the
uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor,
max 5 rounds, then commit with a message starting with the package number and
write a new handoff).

## Verification state of the BugFix-09 commit

- API vitest 654/654 (58 files), API tsc --noEmit, API eslint, web vitest
  47/47, web tsc, web eslint, i18n guard (54 files) — green.
- `docker compose config` and `docker compose -f docker-compose.dockerhub.yml
  --env-file .env.example config --quiet` — valid.
- Compose smoke test (`--build --clean`): all 31 checks PASS, including real
  Nest API bootstrap in dev AND production paths (fresh DB + admin bootstrap
  + login + household action), worker alive, BullMQ job round-trip consumed.
- Review loop: 2 rounds, acceptance met 0/0/0/0.

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
