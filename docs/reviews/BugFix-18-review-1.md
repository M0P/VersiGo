# BugFix-18 Review — Round 1

Date: 2026-08-16
Scope: uncommitted BugFix-18 changes (OIDC reverse-proxy/Caddy callback fix)
Reviewer: code-reviewer subagent (session `ses_ff6e02d19ffeXbT9rZKSF3zyoq`)

## Reviewer result (verbatim)

> # Maximum steps reached
>
> The maximum number of steps allowed for this agent session has been reached, so tools are now disabled. Below is a complete summary of the review work completed, the remaining tasks, and recommendations for continuation.
>
> ## What has been accomplished
>
> I performed a read-only code review of the BugFix-18 changes (OIDC reverse-proxy/Caddy callback fix) in the working tree of `/var/mnt/data/Dokumente/Informatik/VibeCode/VersiGo`. No files were modified.
>
> ### Verified as correct (implementation matches the work package)
>
> 1. **`apps/api/src/features/identity/oidc.strategy.ts:238-263` — `callbackParams()`**
>    - Uses configured `OIDC_CALLBACK_URL` as the base URL (fixes redirect_uri mismatch under prefix-stripping proxies) ✓
>    - Carries over the incoming query string from `req.originalUrl` ✓
>    - Falls back to old `protocol://host + originalUrl` reconstruction when env is unset ✓
>    - Returns `null` on unconstructible/invalid URLs (try/catch around `new URL`) ✓
>    - No dependency on `X-Forwarded-Prefix` or any proxy header ✓
>    - BugFix-07 `AuthService` VALUE import comment preserved (lines 8-18); no top-level import cycle introduced.
>
> 2. **`oidc.strategy.ts:337-350` — `exchangeAndGetClaims` logging**
>    - Logs issuer + `callbackBase = origin + pathname` only — the query string (containing `code`) is deliberately excluded ✓
>    - Logs error constructor name + message; no code/state/verifier/token/secrets ✓
>
> 3. **`apps/api/src/features/identity/auth.controller.ts:240-330` — `callback()`**
>    - All failure redirects now point to `/login?error=...` (was the 404-producing `/auth/login?error=...`) ✓
>    - Link mode preserved: `/settings?error=oidc-link-conflict`, `/settings?error=oidc-link-failed`, `/settings?oidc=linked` ✓
>    - Logging added in both catch blocks (lines 292-296, 323-327) without sensitive data ✓
>
> 4. **`apps/web/src/app/(auth)/login/page.tsx`**
>    - `error` query param read after mount in `useEffect` (hydration-safe, no SSR mismatch) ✓
>    - **Candidate finding (a) resolved as NON-issue:** `t(oidcErrorKey)` at line 210 does NOT fail type checking — the `Translator` signature in `apps/web/src/i18n/core.ts:81-84` accepts `MessagePath<Messages> | (string & {})`, so the `string | null` narrowed to `string` is type-valid ✓
>
> 5. **`apps/web/src/i18n/auth-errors.ts:11-32` — `oidcCallbackErrorKey`**
>    - Fixed switch mapping all 7 error values to `auth.oidcError*` keys; unknown → `null` (no alert rendered) ✓
>
> 6. **Locales** — 7 new keys in `en.ts:123-135` and `de.ts:120-132`, en/de parity maintained ✓
>
> 7. **Tests** — `i18n-helpers.spec.ts:45-70` (mapping + null + parity), `oidc.strategy.spec.ts:356-414` (fallback, proxy-prefix-strip regression, invalid-config null) ✓
>
> 8. **Docs** — `docs/13-settings-catalog.md:142` and `docs/docker-image-guide.md:247-252` document the `/api` requirement ✓
>
> ## Remaining tasks (not completed)
>
> 1. **Test execution** — I could not run the test suites/typecheck (`pnpm run test`, `pnpm run typecheck`, `pnpm run lint`) because step budget was exhausted. This is required to confirm the API specs (`auth.controller.spec.ts` new tests, session-rotation test) pass and to fully close the verdict.
> 2. **Read the remaining truncated regions** — `auth.controller.spec.ts` session-rotation test body (~lines 140-210), and the exact new test content in `oidc.strategy.spec.ts` (lines ~370-430).
>
> ## Candidate findings to classify in the final report
>
> - **[Minor]** `auth.controller.ts:292-296` — the link-mode catch logs `ConflictException` (an expected user-flow outcome: identity already bound) at `warn` level; consider `info`/`debug` for conflict to reduce log noise. (Review-focus item 6.)
> - **[Minor]** `oidc.strategy.ts:243` — when `OIDC_CALLBACK_URL` is set but `req.originalUrl` is undefined, `callbackParams()` returns the base URL without query instead of `null` — a degenerate edge; the subsequent token exchange then fails with `authentication-failed` rather than `invalid-callback`. Behavior is safe, only semantically debatable.
> - **[Minor]** `oidc.strategy.ts:248-250` — query merge with `&` can produce duplicate parameters if the configured `OIDC_CALLBACK_URL` already contains a query string.
> - **[Minor]** `auth.controller.ts:311` — session-rotation failure logs `err.message`; `regenerate` errors are typically non-sensitive but should be sanity-checked.
> - No Critical, High, or Medium findings identified so far.
>
> ## Recommendation for next steps
>
> 1. Run the verification commands (`docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run test"`, `... typecheck`, `... lint`) to confirm green.
> 2. Read `auth.controller.spec.ts` session-rotation test to confirm verifier/state deletion assertions.
> 3. Finalize the report in the required format (CRITICAL/HIGH/MEDIUM/MINOR + verdict). Based on current evidence: likely **PASS** or **CHANGES REQUIRED** depending on whether the Minor items exceed the acceptable count — my current estimate is ≤4 Minor findings, which would be **PASS**, pending test results.

## Formal classification (coordinator)

- CRITICAL: None
- HIGH: None
- MEDIUM: None
- MINOR: 4 (see candidate findings above; all fixable reasonably/safely)
- Verdict: CHANGES REQUESTED — fix the 4 Minor findings (where reasonable and safe), re-verify, then re-review in round 2.

## Note

Test execution was already performed by the coordinator outside the reviewer session (full compose gate `docker compose -p versigo-test -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` → exit 0; log `/tmp/opencode/versigo-test-gate.log`): lint 4/4, typecheck 4/4, API 678 tests, Web 50, Worker 4, Foundation, license check, version-sync check, i18n guard all passed.
