# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-19 (OIDC token-exchange `URLSearchParams` fix) + bump to 1.0.0-beta.4

BugFix-19 is implemented, reviewed (3 review rounds, acceptance condition met
on round 3: 0 Critical / 0 High / 0 Medium / 0 Minor; see
`docs/reviews/BugFix-19-review-1.md` … `BugFix-19-review-3.md`), and committed
on branch `fix/BugFix-09-ci-fix-community-standards-dockerhub` (commit
`d3f539b`). Afterwards the version was bumped `1.0.0-beta.3` →
`1.0.0-beta.4` (user instruction) and this handoff written (second commit).

Package BugFix-19 was a direct user request (no prompt file; the user reported
production logs with a `TypeError: The "chunk" argument must be of type string
or an instance of Buffer or Uint8Array. Received an instance of
URLSearchParams` at the OIDC token exchange):

1. **Root cause** (`apps/api/src/common/connectivity/relaxed-fetch.ts`,
   pre-existing BugFix-06 bug): oauth4webapi 3.8.6 (`authenticatedRequest`,
   `oauth4webapi/build/index.js:1150-1159`) sends the token-endpoint POST body
   as a `URLSearchParams` instance via `(customFetch || fetch)(url.href, { body,
   ... })`. `relaxedFetch` passed that object straight to
   `http.request().write()` → Node `ERR_INVALID_ARG_TYPE` → the token exchange
   never reached the IdP (`OIDC token exchange failed ... UnauthorizedException:
   OIDC authentication failed` on login AND link flows). Discovery/JWKS/userinfo
   are GET requests without a body → unaffected, which is why the bug was
   invisible until BugFix-18's logging surfaced it.
2. **Fix**: `normalizeBody(rawBody)` converts `fetch`-style bodies into
   `string | Buffer`: `URLSearchParams` → `.toString()`, string passthrough,
   `ArrayBuffer` → `Buffer.from`, `ArrayBuffer.isView` (TypedArray/DataView) →
   `Buffer.from(buffer, byteOffset, byteLength)` (only the view's own bytes),
   `Blob`/`FormData`/`ReadableStream` → `{ unsupported: true }` → 400 response.
   `content-length` is added when a body exists and the caller did not already
   set it (`Headers.has` guard); the caller's `content-type` (set by
   oauth4webapi) is preserved. 10 s timeout and `rejectUnauthorized: false`
   unchanged. Discriminated union `{ unsupported: true } | { unsupported: false;
   value?: string | Buffer }`.
3. **Tests** (`apps/api/src/common/connectivity/__tests__/relaxed-fetch.spec.ts`,
   new, 9 tests): URLSearchParams POST regression (the exact bug), string body +
   caller content-type preserved, GET without a body (no `content-length`
   header), raw `ArrayBuffer` full byte range, `Uint8Array` view with non-zero
   `byteOffset`/`byteLength` (subarray over `'XX{"a":1}YY'`, indices derived
   from the expected payload), caller-provided `content-length` not overridden,
   non-http(s) protocol → 400, `Blob` → 400 without network, upstream 400 JSON
   propagated. Uses real HTTP servers; skips when `OIDC_AUTH` env set.
4. **Log line note**: the user's second log line `OIDC self-service link
   failed: UnauthorizedException: OIDC authentication failed` is the expected
   link-mode wrapper (AuthController catch around
   `exchangeIdentity`→`exchangeAndGetClaims`) and disappears once the token
   exchange succeeds. After this fix, retest in the user's environment.

**Review loop history (3 rounds, acceptance met):** R1 0/0/0/4 (minors:
overstated ReadableStream doc comment; missing isView-offset + caller
content-length tests; unnecessary `as ArrayBuffer` cast; loose
`NormalizedBody` type) → all four fixed → R2 0/0/1/0 CHANGES REQUESTED with one
MEDIUM that was a **false positive** (reviewer miscounted `'XX{"a":1}YY'` as 10
bytes; it is 11 — `{"a":1}` has quotes around `a`; verified by byte dump +
Node). Disposition recorded in `BugFix-19-review-2.md`; the subarray test was
rewritten to derive indices from the expected payload so no hand-counted math
can drift → R3 0/0/0/0 (ACCEPT).

**Verification state of the BugFix-19 commit (`d3f539b`):**
- Full compose gate on the final tree (`docker compose -p versigo-test -f
  docker-compose.test.yml up --build --abort-on-container-exit
  --exit-code-from test`): exit 0, "All checks passed!" — lint 4/4,
  typecheck 4/4, API 59 files / 688 tests (incl. 9/9 relaxed-fetch), license
  check (578 packages) OK, version-sync check `1.0.0-beta.3` OK, i18n guard OK
  (54 files). Test stack torn down afterwards (`down -v`).
- Version bump to `1.0.0-beta.4`: `node scripts/check-version-sync.mjs` → OK
  ("all locations match 1.0.0-beta.4"). No `pnpm-lock.yaml` change needed.
- Bump reminder (from the script): `NEXT_PUBLIC_APP_VERSION` is injected at
  container STARTUP (`apps/web/docker-entrypoint.sh` → `/runtime-config.js`),
  so a web container restart is enough to show beta.4 in the footer (no image
  rebuild).

## No next work package exists

`prompts/` contains no numbered work package after
`prompts/BugFix-18-oidc-reverse-proxy-caddy.md` (last numbered file; BugFix-19
had no prompt file — it was a direct user request). All defined packages
(AP-01 … AP-21, BugFix-01 … BugFix-19) are committed.

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/` (or a direct request), implement only that
one and use the same review loop: invoke the `code-reviewer` subagent via the
Task tool on the uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor, max
5 review rounds, then commit with a message starting with the package number
and write a new handoff (this file).

**Reviewer quirk (learned in BugFix-18/-19):** the `code-reviewer` subagent has
NO shell tool and exhausts its step budget quickly when asked to run `git diff`
or to re-read many files. Give it the diff INLINE in the Task prompt (or a
single repo file it can Read) and keep its file list to the touched sources +
tests. Some sessions ended at "maximum steps reached" with the formal report
missing – the coordinator then finalized the classification from the session's
detailed candidate-finding summary (still a valid review result: the Task tool
successfully invoked the code-reviewer). It can also miscount string lengths
(BugFix-19 round 2) – verify any byte-count finding against the file with
`node -e` before acting.

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
