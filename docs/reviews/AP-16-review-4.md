# AP-16 Review — Iteration 4

Review executed: 2026-08-01 by the `@code-reviewer` subagent (read-only) against the
uncommitted AP-16 change set on `feat/AP-16-roles-rechte-lokale-registrierung`
(HEAD `9c9f19300bef078f0c1e326445916a593a285625`).

Review result saved verbatim below (as returned by the code-reviewer):

---

**STATEMENT: Maximum steps for this review agent were reached before the report could be finalized via a separate pass. The report below is based on the complete static inspection performed up to the interruption: all 7 round-3 findings were individually verified against the actual files/lines, the new OIDC spec was reviewed, and a broad fresh-findings sweep of the identity feature, migrations, web pages/hooks, config schema, main.ts, compose files, .env.example, docs, and smoke-test script was performed. Not re-run (read-only environment): the docker-compose test gate and the compose smoke test (implementer reports both green). Remaining uncompleted items: a final pass over the worker processor path and the prisma/schema.prisma diff, and re-reading a few secondary web pages (admin/settings, admin/integrations, admin/feature-flags, household/costs, policies/*) that were unchanged from round 3.**

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: APPROVED WITH MINOR NOTES

## Findings

### Round-3 verification (all 7 findings — VERIFIED RESOLVED)

- [Fixed] Medium#1 — OIDC strategy migrated to openid-client v6. `apps/api/src/features/identity/oidc.strategy.ts:5-13` imports only v6 exports (`authorizationCodeGrant`, `buildAuthorizationUrl`, `calculatePKCECodeChallenge`, `discovery`, `randomPKCECodeVerifier`, `randomState`, `type Configuration`) matching openid-client 6.8.4 (pinned, pnpm-lock.yaml:2569/5659, apps/api/package.json:30). No `any` casts remain; grep for `Issuer.discover|generators.|client.callback|UPGRADE` finds only the comment on line 22 (documentation of v6 semantics), no v5 runtime API. `discovery(new URL(...), clientId, { redirect_uris, client_secret })` (lines 83-86) is the correct v6 signature; `buildAuthorizationUrl` + PKCE/state params (lines 127-133) and `authorizationCodeGrant(client, currentUrl, { expectedState, pkceCodeVerifier })` + `tokenSet.claims()` (lines 150-159) match the v6 API. `normalizeIssuerUrl` is applied in BOTH paths: `user-admin.service.ts:239` (admin bind, `data: { oidcIssuer: normalizeIssuerUrl(oidcIssuer), ... }`) and `oidc.strategy.ts:173` (login, `findByOidcIdentity(normalizeIssuerUrl(issuer), claims.sub)`), so trailing-slash variance cannot break login. Fail-closed behavior preserved (generic 401 for exchange errors and unbound identities; specific messages only for missing sub/iss, no account/binding leakage). New spec `apps/api/src/features/identity/__tests__/oidc.strategy.spec.ts` covers normalizeIssuerUrl, onModuleInit (disabled/success/discovery-failure), callbackParams (full URL + null on missing host/originalUrl), getAuthorizationUrl (PKCE/state + unconfigured throw), and validateCallback (no-client, token-exchange failure, normalized-issuer success, missing iss, unbound generic). Mock setup (`vi.mock` of all 6 functions) is correct; assertions match the strategy's fail-closed behavior.
- [Fixed] Medium#2 — CORS enabled. `packages/foundation/src/config/app-config.schema.ts:77-86` adds `CORS_ORIGINS` (string default, comma-split/trim/filter-empty, empty→default fallback); `apps/api/src/main.ts:33-36` calls `app.enableCors({ origin: config.get('CORS_ORIGINS'), credentials: true })`; `.env.example:38`, `docker-compose.yml:89` (`${CORS_ORIGINS:-http://localhost:3000}`), `docs/08-admin-operations.md:20`, and `scripts/compose-smoke-test.sh:101-104` passthrough all present; 3 new schema tests (`app-config.schema.spec.ts:143-162`) cover default, comma-trim, and empty-fallback.
- [Fixed] Minor#3 — `apps/api/src/features/identity/auth.controller.ts:99-102`: register catch-block comment now states only conflict/enumeration hits (409) count; code matches (only `ConflictException` calls `recordAttempt`).
- [Fixed] Minor#4 — `apps/web/src/hooks/use-current-user.ts:32-64` gains `enabled?: boolean` (false → no fetch); `apps/web/src/components/ui/app-shell.tsx:21,35-38` gains optional `user` prop and uses `useCurrentUser({ enabled: !hasExternalUser })`; `apps/web/src/app/settings/page.tsx:22,31,42` passes the resolved user to all three AppShell usages. Grep confirms the only `useCurrentUser` consumers are app-shell.tsx and settings/page.tsx — the duplicate `/auth/me` is eliminated.
- [Fixed] Minor#5 — `prisma/migrations/20260731120000_ap16_global_roles_local_registration/migration.sql:45,52` truncate email/OIDC-subject backfills to `left(..., 24)`; collision loop (lines 87-106) uses `'user-' || left(replace(id,'-',''), LEAST(segment_len,27))` = max 5+27=32 chars, charset `[a-z0-9.-]` (starts with letter), 6-iteration guard with `RAISE EXCEPTION` fallback. Final username length can never exceed 32 chars (verified: 24-char backfills, 13-char id fallback, 32-char collision form), so no migrated user is locked out by `@Length(3,32)`.
- [Fixed] Minor#6 — `apps/web/src/app/(auth)/login/page.tsx:29-41` adds `safeRedirectPath` (decodeURIComponent with '/'-fallback, rejects non-'/' starts, `//`, `/\\`, `\`, >2048 chars); SSR-safe lazy state initializer (lines 54-58); `window.location.href = redirectTo` on success (line 92). Open-redirect vectors (scheme-relative, backslash, double-encoded) are rejected.
- [Fixed] Minor#7 — `apps/api/src/features/identity/auth.controller.ts:166-184`: `rateLimiter.resetAttempts(ip)` moved inside the `req.session.regenerate` callback (line 171), only executed after confirmed rotation; spec `auth.controller.spec.ts:400-418` still asserts `resetAttempts` is called on success.

### Fresh findings

- [Minor] `apps/api/src/features/identity/auth.controller.ts:63` — `/auth/config` reports `oidcEnabled` from the capability flag (`this.capabilities.isEnabled('oidc')`), not from `this.oidc.isEnabled()`. If OIDC discovery fails at boot (`OidcStrategy.discoverClient` logs and leaves `client=null`, `oidc.strategy.ts:65-91`), the login page (`login/page.tsx:210-219`) still renders the "Mit OIDC anmelden" button while `GET /auth/login` returns 501 (auth.controller.ts:45-51). Fail-closed behavior is intact (no security exposure); this is a UX/consistency gap between the reported capability and the actually-usable strategy.
  - Required fix: derive the advertised `oidcEnabled` from `this.oidc.isEnabled()` (or expose a `ready` flag on the strategy) so the UI hides the OIDC button when discovery failed.

## Verification
- Tests/checks reviewed: static inspection only (no Docker execution possible in this read-only environment). Inspected: `oidc.strategy.spec.ts` (mock setup, fail-closed assertions, normalized-issuer success case, missing-iss rejection, unbound generic 401), `auth.controller.spec.ts` (login async/await, register 409/429/scope counting, localLogin reset-inside-regenerate, session rotation, logout), `user-admin.service.spec.ts` (approve/reject/disable/enable/setRole/bind/unbind, P2002 translation, P2034 bounded retry), `app-config.schema.spec.ts` (3 new CORS tests + existing defaults), plus roles.guard/auth.service/local-admin.bootstrap/rate-limiter specs from prior context. The implementer reports both gates green (`docker compose -f docker-compose.test.yml ... test`: 34 files/413 tests + lint + typecheck + prisma migrate deploy + build; `compose-smoke-test.sh --build` all steps incl. worker startup and BullMQ round-trip; the intermittent step-9 log-drop is documented as a machine-specific rootless-podman journald issue, not an AP-16 defect).
- Important areas inspected: full identity feature (strategy, controller, service, guards, admin service/controller/DTOs, bootstrap, rate limiter, module), both AP-16 migrations, web pages/hooks/middleware (login/register/pending/callback/settings/admin-users/app-shell/use-current-user), config schema + main.ts CORS wiring, docker-compose.yml, .env.example, docs/08, compose-smoke-test.sh.
- Remaining risks (not fully re-verified in this pass due to the step limit): worker processor DB path and prisma/schema.prisma diff; runtime behavior of the OIDC strategy against a live openid-client 6.8.4 (spec is fully mocked); real-browser CORS behavior. None of these are new to this round.

## Severity counts (one line)
Critical: 0, High: 0, Medium: 0, Minor: 1 — Verdict: APPROVED WITH MINOR NOTES

---

**Remaining tasks not completed:** a final sweep of the worker processor and `prisma/schema.prisma`, and re-reading the secondary web pages (admin/settings, admin/integrations, admin/feature-flags, household/costs, policies/*) for this round's diff. **Recommendation:** apply the single Minor fix (advertise `oidcEnabled` from `OidcStrategy.isEnabled()` in `/auth/config`) at your discretion; AP-16 acceptance criteria (0 Critical/High/Medium, ≤8 Minor, gates green) are met.
