# BugFix-18 – OIDC (PocketID) fails behind Caddy reverse proxy with `uri strip_prefix /api` (login 404 + generic link failure)

Source: user request (2026-08-16) — OIDC login and self-service account linking do not work behind a Caddy reverse proxy, despite correct settings. Deployment: app runs locally on `192.168.24.8`, reachable via Caddy as `https://versicherung.home`; PocketID instance on `id.home` (verified working with other applications). Symptoms: (a) the OIDC button on the initial login page leads to a **404** at `https://versicherung.home/auth/login?error=authentication-failed`, (b) self-service account linking fails with only the generic UI error message, (c) **no error logs at all** (production build).

## Context (what exists today)

- Repo HEAD: `705e693` (BugFix-17 committed as `8f814b5` + handoff `0fa4123`; 13 review rounds, final 0/0/0/0). Handoff: `docs/reviews/NEXT-CODING-AGENT-PROMPT.md`.
- Production deployment of the user:
  - Direct access: `http://192.168.24.8:2470` (web) / API `http://192.168.24.8:2669` (both working; login via direct IP works).
  - Caddy reverse proxy `versicherung.home` (user's Caddyfile):
    ```
    versicherung.home {
        tls internal
        handle /api/* {
            uri strip_prefix /api
            reverse_proxy api:3001
        }
        handle {
            reverse_proxy web:3000
        }
    }
    ```
  - PocketID: `https://id.home` (functional; `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` / `CONNECTIVITY_ALLOW_SELF_SIGNED` flags are set as needed so discovery and TLS work).
  - `CORS_ORIGINS=http://192.168.24.8:2470,https://versicherung.home` and `TRUST_PROXY=true` are set (CORS/trust-proxy already fixed in a previous session; login page itself renders and direct login works).
  - `OIDC_CALLBACK_URL` is set to the public proxy URL **with** the `/api` prefix: `https://versicherung.home/api/auth/callback`.
  - Production environment (`NODE_ENV=production`, no debug/verbose logging).
- OIDC stack: `apps/api/src/features/identity/oidc.strategy.ts` (openid-client v6, pinned `openid-client@6.8.4`), `apps/api/src/features/identity/auth.controller.ts` (`GET /auth/login` and `GET /auth/callback`), `apps/web/src/app/(auth)/login/page.tsx` (login page, OIDC button links to `${apiBaseUrl}/auth/login`), `apps/web/src/app/(auth)/callback/page.tsx` (fallback spinner page — the real callback is handled server-side by the API), `apps/web/src/app/settings/page.tsx` (maps `error=oidc-link-conflict` / `oidc-link-failed` to localized messages).

## PROVEN root cause (verified against openid-client v6 source)

**The `redirect_uri` sent in the token exchange does not match the one used in the authorization request**, because `callbackParams()` reconstructs the callback URL from the (already prefix-stripped) incoming request, while `getAuthorizationUrl()` uses the configured `OIDC_CALLBACK_URL`.

1. `getAuthorizationUrl()` (oidc.strategy.ts:241-254) builds the authorization URL with `redirect_uri = OIDC_CALLBACK_URL` = `https://versicherung.home/api/auth/callback`. PocketID records this exact `redirect_uri`.
2. Caddy rewrites the IdP callback `GET /api/auth/callback?code=…&state=…` to `GET /auth/callback?code=…&state=…` (`uri strip_prefix /api`) before proxying to `api:3001`. The API therefore sees `req.originalUrl = /auth/callback?…` **without** the `/api` prefix.
3. `callbackParams()` (oidc.strategy.ts:225-235) builds `new URL(\`${req.protocol}://${host}${req.originalUrl}\`)` → `https://versicherung.home/auth/callback?code=…&state=…` (again **without** `/api`).
4. `validateCallback()` / `exchangeIdentity()` pass this URL as `currentUrl` to `authorizationCodeGrant()` (openid-client v6). Verified in `node_modules/.pnpm/openid-client@6.8.4/node_modules/openid-client/build/index.js:974`: `redirectUri = stripParams(currentUrl)` — the `redirect_uri` in the token-exchange POST is derived **from the reconstructed callback URL**, i.e. `https://versicherung.home/auth/callback` (no `/api`).
5. PocketID (like any conformant OIDC provider) rejects the token request because the `redirect_uri` does not exactly match the one from the authorization request → token exchange fails → `UnauthorizedException`/generic failure → `error=authentication-failed` (login) or generic `oidc-link-failed` (link flow).
6. The failure is **swallowed without logging**: `exchangeAndGetClaims`/`exchangeIdentity` and the controller `catch` blocks (auth.controller.ts:284-291, 307-309) do not log the underlying error. Hence "no error logs in production".

**Why the user sees a 404:** after the failed exchange the controller redirects to the **relative path** `'/auth/login?error=authentication-failed'` (auth.controller.ts:240,246,252,258,273,299,308). The browser resolves `/auth/login?error=…` against the proxy origin → `https://versicherung.home/auth/login?error=…`. That path does not match Caddy's `handle /api/*` (no `/api` prefix) and falls through to the web app (`web:3000`). Next.js has **no route** `/auth/login` (the login page lives at `/login` in the `(auth)` route group) → **404**. Additionally, the login page currently does not display the `error` query parameter at all.

## Scope

### 1. Fix the root cause: `callbackParams()` must use the configured `OIDC_CALLBACK_URL` as the base
- The token-exchange `redirect_uri` must always equal the `redirect_uri` used in the authorization request. Since that is by definition `OIDC_CALLBACK_URL`, `callbackParams()` should build the callback URL from the **configured `OIDC_CALLBACK_URL`** and carry over the query parameters (`code`, `state`, …) from the actual incoming request — instead of reconstructing `protocol://host + originalUrl`.
- Recommended approach:
  - If `OIDC_CALLBACK_URL` is configured and valid: `const url = new URL(OIDC_CALLBACK_URL);` then append/copy the query string from `req.originalUrl` (everything after `?`), returning that `URL`.
  - Keep returning `null` when the callback URL is not constructible (`invalid-callback` path in the controller must still work).
  - Keep the existing behavior when the base is not derivable.
- This is robust against ANY proxy prefix stripping (Caddy, nginx, subdomain-based proxies, direct-IP access) — do NOT rely on `X-Forwarded-Prefix` or on forcing a Caddy config change (the user's Caddyfile is already the documented reference config; the app must work behind it unchanged).
- Preserve the BugFix-07 constraints: `AuthService` stays a VALUE import in `oidc.strategy.ts`; no module-evaluation-time cycle between `auth.service` and `oidc.strategy`.

### 2. Fix the redirect targets after OIDC failures (the 404)
- All `res.redirect('/auth/login?error=…')` calls in `auth.controller.ts` (lines 240, 246, 252, 258, 273, 299, 308) must point to the **web login route** `/login?error=…` instead of `/auth/login?error=…` (the latter is the API route, not a web page).
- Make the login page render the error: `apps/web/src/app/(auth)/login/page.tsx` should read the `error` query parameter (e.g. `authentication-failed`, `missing-code-verifier`, `invalid-callback`, `missing-state`, `oidc-not-configured`, `not-authenticated`, `session`) and display a localized message. Reuse/extend the existing auth i18n keys (see `auth.loginErrorTitle`, `auth.loginErrorDefault`, `auth.connectionError` in `apps/web/src/i18n/locales/de.ts` around line 95 and the en locale). Add specific messages for the OIDC error values above.
- `settings/page.tsx` already handles `/settings?error=oidc-link-failed` and `?oidc=linked` — keep that behavior; verify the `oidc-link-failed` wording is generic (no internals leaked).

### 3. Add error logging to the OIDC failure paths
- Production currently logs nothing on OIDC failure — diagnose the cause is impossible. Add `Logger`-based logging (warning/error level, no verbose debug) in:
  - `exchangeAndGetClaims` / `exchangeIdentity` catch paths (log the error message/class, the issuer if available, and the base callback URL — **never** log `code`, `state`, `code_verifier`, tokens, or secrets).
  - The controller `catch` blocks (auth.controller.ts:284-291 and 307-309) — log the underlying error before redirecting.
- Keep log output free of sensitive material (review this explicitly).

### 4. Tests
- Update `apps/api/src/features/identity/__tests__/oidc.strategy.spec.ts` `callbackParams` suite (lines ~355-390): the tests currently assert reconstruction from `protocol`/`host`/`originalUrl`; they must assert the new behavior (base = configured `OIDC_CALLBACK_URL`, query params carried over, `null` on missing/`invalid` config). Add a regression test that simulates the proxy scenario: `originalUrl = '/auth/callback?code=abc&state=xyz'` (already prefix-stripped) with `OIDC_CALLBACK_URL = 'https://versicherung.home/api/auth/callback'` → result must be `https://versicherung.home/api/auth/callback?code=abc&state=xyz`.
- Update `apps/api/src/features/identity/__tests__/auth.controller.spec.ts`: the mock at line 79 already returns a plain object `{ code: 'auth-code', state: 'state' }` — check whether the controller now expects a `URL` (adjust mocks/assertions accordingly, e.g. `validateCallback` receives a `URL`). Update redirect-target assertions to `/login?error=…`.
- Add/update web tests for the login page error display if such tests exist; at minimum run the web test suite.
- Keep the session-rotation test (`auth.controller.spec.ts:141-173`) green: success still redirects to `/`, session regenerate/destroy still called, verifier/state still deleted.

### 5. Verification (mandatory, in this order)
1. `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` (or the compose equivalents from AGENTS.md) — all green.
2. **Manual end-to-end verification against the real setup is NOT possible from this machine** (PocketID, Caddy, `versicherung.home` DNS live on the user's LAN). Simulate instead: unit tests for the proxy scenario (step 4) are the primary proof. If a local IdP mock (e.g. `oidc-provider`) is already used in tests, reuse it; do not add heavy new dev dependencies just for this.
3. Update the documentation if it recommends `OIDC_CALLBACK_URL` formats: `docs/docker-image-guide.md` (Caddy dual-access section, ~lines 220-248) and `docs/13-settings-catalog.md` (~line 142). Add an explicit note: **when the app is behind a reverse proxy that strips the `/api` prefix, `OIDC_CALLBACK_URL` must be the public proxy URL including `/api` (e.g. `https://versicherung.home/api/auth/callback`), and the IdP client must be registered with exactly that redirect URI.** Mention that the app resolves the callback URL from this setting (not from the proxy-visible request path), so the proxy may freely strip/rewrite prefixes.

## Acceptance criteria

- Zero Critical, zero High, zero Medium, at most 8 Minor findings from the `code-reviewer` (same loop as BugFix-17: verbatim review files to `docs/reviews/BugFix-18-review-<n>.md`, fix all findings, re-review until 0/0/0/≤8; at most 5 rounds).
- `callbackParams()` derives the callback base from `OIDC_CALLBACK_URL` and the unit tests prove the proxy-prefix-strip scenario yields the correctly prefixed URL.
- All OIDC failure redirects go to `/login?error=…` (web route) — no more 404 on the login page — and the login page displays a localized message for the error values listed in scope 2.
- OIDC failures are logged (without secrets) so the user can diagnose production issues.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` pass (compose equivalents per AGENTS.md).
- Documentation note added per scope 5.
- Commit message starts with `BugFix-18:` and contains only this package's changes. Update `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` afterwards with the next package (there is none yet — leave the handoff pointing at a future user request, or state that BugFix-19 does not exist yet; follow the BugFix-17 handoff pattern).
