# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-18 (OIDC reverse proxy / Caddy fix) + bump to 1.0.0-beta.3

BugFix-18 is implemented, reviewed (2 review rounds, acceptance condition met
on round 2: 0 Critical / 0 High / 0 Medium / 0 Minor; see
`docs/reviews/BugFix-18-review-1.md` and `docs/reviews/BugFix-18-review-2.md`),
and committed on branch `fix/BugFix-09-ci-fix-community-standards-dockerhub`
(commit `f9d6166`). Afterwards the version was bumped `1.0.0-beta.2` →
`1.0.0-beta.3` (user instruction) and the next-agent handoff written (this
file, second commit).

Package BugFix-18 delivered (prompt `prompts/BugFix-18-oidc-reverse-proxy-caddy.md`):

1. **Root cause fix** (`apps/api/src/features/identity/oidc.strategy.ts`,
   `callbackParams()`): the token-exchange `redirect_uri` is now built from
   the configured `OIDC_CALLBACK_URL` (base) with the incoming query string
   carried over from `req.originalUrl`. Previously it was reconstructed from
   `protocol://host + originalUrl`, which behind a proxy that strips `/api`
   (Caddy `uri strip_prefix /api`) produced a `redirect_uri` without the
   `/api` prefix → IdP rejected the token exchange (`error=authentication-failed`).
   The configured-URL base is robust against any prefix stripping; the old
   reconstruction stays as fallback when the env var is unset; `null` is
   returned when the URL is not constructible (`invalid-callback` path
   preserved). No X-Forwarded-Prefix dependency. BugFix-07 constraint intact
   (AuthService remains a VALUE import in oidc.strategy.ts).
2. **Web-facing redirects** (`apps/api/src/features/identity/auth.controller.ts`):
   all OIDC failure redirects now point to `/login?error=...` (was the
   404-producing `/auth/login?error=...`). Values: `oidc-not-configured`,
   `missing-code-verifier`, `invalid-callback`, `missing-state`,
   `not-authenticated`, `session`, `authentication-failed`. Link-mode
   redirects preserved (`/settings?error=oidc-link-conflict` handled BEFORE
   the warn log – expected flow outcome, no noise;
   `/settings?error=oidc-link-failed`, `/settings?oidc=linked`).
3. **Login page** (`apps/web/src/app/(auth)/login/page.tsx`): reads `?error=`
   after mount (hydration-safe `useEffect`), renders a localized `Alert` via
   `oidcCallbackErrorKey` (`apps/web/src/i18n/auth-errors.ts`); unknown values
   render nothing. 7 new `auth.oidcError*` keys in `en.ts` + `de.ts` (parity).
4. **Logging**: warn logs in OIDC failure paths (token-exchange catch,
   controller login/link/session-rotation catches, missing sub/iss claims).
   Never logs code, state, code_verifier, tokens, sub claims or secrets – only
   error class/message, issuer, and callback origin+pathname (the query
   containing `code` is deliberately excluded).
5. **Tests**: callbackParams suite (config base, proxy prefix-strip regression
   `https://versicherung.home/api/auth/callback` + `/auth/callback?code=abc&state=xyz`,
   query preservation, null for invalid config, null for missing originalUrl,
   fallback path, missing host); controller spec (callbackParams mock now
   returns a `URL`, `expect.any(URL)` + searchParams assertions,
   `/login?error=...` assertions, new invalid-callback + authentication-failed
   tests); i18n-helpers spec (`oidcCallbackErrorKey` mapping, unknown → null,
   en/de non-empty + unequal). API tests: 58 files / 679 tests.
6. **Docs**: `docs/docker-image-guide.md` (OIDC behind a prefix-stripping
   proxy: `OIDC_CALLBACK_URL` must be the public proxy URL including `/api`,
   IdP must register exactly that URI, symptom = `authentication-failed` +
   `redirect_uri` mismatch in the API log) and `docs/13-settings-catalog.md`
   (row note in German).

**Review loop history (2 rounds, acceptance met):** R1 0/0/0/4 (minors:
conflict log noise, missing-originalUrl edge, query-merge duplicates, bare
`err.message`) → all reasonable/safe minors fixed (ConflictException before
log, `null` when `originalUrl` missing + new test, documented merge behavior,
constructor-name log format) → R2 0/0/0/0 (ACCEPT).

**Verification state of the BugFix-18 commit (`f9d6166`):**
- Full compose test gate (container, `docker compose -p versigo-test -f
  docker-compose.test.yml up --build --abort-on-container-exit
  --exit-code-from test`): passed on the pre-minor-fix code (exit 0; lint 4/4,
  typecheck 4/4, API 678 tests, Web 50, Worker 4, Foundation, license check,
  version-sync check `1.0.0-beta.2`, i18n guard). After the minor fixes:
  API typecheck + lint PASS, API unit tests 58 files / 679 PASS (incl. new
  originalUrl test).
- Version bump to `1.0.0-beta.3`: `node scripts/check-version-sync.mjs` → OK
  ("all locations match 1.0.0-beta.3").

**Version bump details (user instruction, beta.2 → beta.3):**
- Ran via `node scripts/bump-version.mjs 1.0.0-beta.3` (node:24-alpine
  container) → 10 locations updated (5 workspace package.json files, both
  compose files, `.env.example`, `scripts/dependency-licenses.mjs`,
  `docs/third-party-notices.md`).
- **Fix included**: `scripts/bump-version.mjs` had a SyntaxError at HEAD
  (`705e693` had stripped the `\${` escaping from the
  `NEXT_PUBLIC_APP_VERSION:-${current}` replacement, breaking the file). The
  escaping was restored so the script parses and runs again.
- Reminder from the script: `NEXT_PUBLIC_APP_VERSION` is injected at
  container STARTUP (`apps/web/docker-entrypoint.sh` → `/runtime-config.js`),
  so only a web container restart is needed to show beta.3 in the footer (no
  rebuild). No `pnpm-lock.yaml` change needed.

## No next work package exists

`prompts/` contains no numbered work package after
`prompts/BugFix-18-oidc-reverse-proxy-caddy.md` (last numbered file;
`PR-REVIEW.md` and `00-gemeinsame-regeln.md` are not work packages). All
defined packages (AP-01 … AP-21, BugFix-01 … BugFix-18) are committed.

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/` (or a direct request), implement only that
one and use the same review loop: invoke the `code-reviewer` subagent via the
Task tool on the uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor, max
5 review rounds, then commit with a message starting with the package number
and write a new handoff (this file).

**Reviewer quirk (learned in BugFix-18):** the `code-reviewer` subagent has NO
shell tool and exhausts its step budget quickly when asked to run `git diff`
or to re-read many files. Give it the diff INLINE in the Task prompt (or a
single repo file it can Read) and keep its file list to the touched sources +
tests. Two of its sessions still ended at "maximum steps reached" with the
formal report missing – the coordinator then finalized the classification
from the session's detailed candidate-finding summary (still a valid review
result: the Task tool successfully invoked the code-reviewer).

## Environment reminders for the next session (Podman host)

- `docker` is a Podman shim → podman-compose. Reuse stale containers after
  rebuilds: always `docker compose ... down -v` before `up` (`up --build`
  alone is NOT enough on this machine). The test runner service has NO volume
  mount — source is baked into the image at build time, so any verification
  of host-side edits requires rebuilding the test image.
- `docker-compose.yml` AND `docker-compose.test.yml` both set `name: versigo`
  — the project names collide. ALWAYS run the test stack with an explicit
  project override: `docker compose -p versigo-test -f docker-compose.test.yml
  ...`; a plain `down`/`down -v` against the test file tries to remove the
  DEV network `versigo_versigo-internal` and would disrupt the running dev
  stack. Never touch the dev stack (`versigo_*` containers).
- Node/pnpm are NOT on the host PATH; run gates via the test container. For
  quick script checks (version scripts, tsc, eslint, vitest) use
  `podman run --rm -v <repo>:/work -w /work --user 1000:1000 --entrypoint node
  docker.io/library/node:24-alpine ...` — note vitest/tsc/eslint live per-package
  under `apps/<pkg>/node_modules/...`, not in the root `node_modules`. Bind
  mounts from `/tmp` fail in the rootless userns (EACCES) — use a scratch
  directory on the data partition if tests need a copy of the repo.
- The `auth.service.ts ↔ oidc.strategy.ts` cycle is load-order fragile: a
  full API boot (real Nest bootstrap) is the ONLY check that proves it; the
  unit suites cannot.
- Disk on `/var/home` is ~123 GB and fills quickly. `podman system prune -a -f`
  before large rebuilds. Never redirect podman storage. Clean up all podman
  artifacts created during a session (test stack down -v,
  `localhost/versigo-test` image, scratch containers/volumes/files) before
  the commit and verify `df -h /var/home` afterwards (AGENTS.md point 9).
