# AP-16 Review — Iteration 3

Review executed: 2026-08-01 by the `@code-reviewer` subagent (read-only) against the
uncommitted AP-16 change set on `feat/AP-16-roles-rechte-lokale-registrierung`
(HEAD `9c9f19300bef078f0c1e326445916a593a285625`).

Review result saved verbatim below (as returned by the code-reviewer):

---

**STATEMENT: This pass completed the review that was interrupted in round 3. Both automated gates were NOT re-run (per instruction); the implementer reports the canonical docker-compose test stack (33 API files / 398 tests, lint, typecheck, prisma migrate deploy) and `./scripts/compose-smoke-test.sh --build` as green. Files inspected: both AP-16 migrations, full identity feature (auth service/controller/DTOs, guards, OIDC strategy, user-admin service/controller/DTO, bootstrap, password hashing, rate limiter, module), main.ts, app-config schema + spec, docker-compose(.override/.test).yml, .env.example, compose-smoke-test.sh, next.config.ts, web middleware/hooks/pages (login/register/pending/callback/forbidden/settings/admin-users), docs 07/08, ADR-007, and the identity test specs.**

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 2
- Minor: 5
- Verdict: CHANGES REQUIRED

## Findings

### Round-2 verification (both findings resolved — VERIFIED CORRECT)

- [Fixed] Medium#1 — READ_ONLY demotion in the migration now implements the "exclusively VIEWER" rule. `prisma/migrations/20260731120000_ap16_global_roles_local_registration/migration.sql:124-134` sets `role='READ_ONLY'` only when `role='USER'` AND `EXISTS (… hm."role" = 'VIEWER')` AND `NOT EXISTS (… hm."role" = 'MEMBER')`. Ordering is correct: the ADMIN pass (lines 110-115) runs first, so an OWNER/ADMIN membership already yields ADMIN and the second UPDATE's `WHERE u."role" = 'USER'` excludes those users; a MEMBER+VIEWER user stays USER (max-wins, verlustfrei). Matches ADR-007 §5.
- [Fixed] Minor#1 — Admin navigation gating landed. `apps/web/src/components/ui/app-shell.tsx:38-46`: `const isAdmin = user?.role === 'ADMIN'`; items with `href === '/admin'` or `href.startsWith('/admin/')` are filtered out for non-ADMIN, and `.filter((section) => section.items.length > 0)` drops empty sections. No flash of an unauthorized link: while `user` is still loading/null the link stays hidden and only appears after the server confirms `role === 'ADMIN'`; enforcement remains server-side (RolesGuard), so this is a correct UX measure.

### Fresh findings (new in this pass)

- [Medium] `apps/api/src/features/identity/oidc.strategy.ts:7-16,71-73` — OIDC login flow is non-functional with the pinned `openid-client ^6.8.0`
  - Evidence: The strategy casts to `any` (`const Issuer: any = (oidc as any).Issuer;` etc.) and its own comment states the openid-client v5 exports ("Issuer, Client, generators") are undefined at runtime under v6 and that migrating to the v6 API is deferred to a separate work package. Additionally, `Client.callbackParams(req)` (line 71) relies on a top-level `Client` export that openid-client never exposes in v5 or v6 (the Client class is `issuer.Client`), so the `/auth/callback` path throws. Either failure mode disables the flow (onModuleInit leaves `client=null` → `isEnabled()` false → `/auth/login` returns 501). There is no spec exercising `OidcStrategy` (no `oidc.strategy.spec.ts` exists), so the green test/smoke runs (local-auth-only) cannot detect it. The failure is fail-closed (no security exposure), but the AP-16 OIDC-binding feature (admin binding + OIDC login) is unusable at runtime.
  - Required fix: Migrate the strategy to the openid-client v6 API (`Issuer.discover`/`new issuer.Client`/`client.callbackParams`) within this work package, or remove the OIDC feature surface from AP-16 and track it explicitly; add a unit test for `callbackParams`/`validateCallback` failure paths. Normalize the `claims.iss` comparison against `OIDC_ISSUER_URL` (trailing-slash variance currently determines bindability).

- [Medium] `apps/api/src/main.ts` (no `enableCors`) + `apps/web/src/hooks/use-current-user.ts:14,33`, `apps/web/src/app/(auth)/login/page.tsx:23,55`, `apps/web/src/app/(auth)/register/page.tsx:17,32` — the AP-16 browser flows (login, register, `/auth/me`, admin-users) cannot read API responses due to missing CORS
  - Evidence: Every web page fetches the API at the absolute cross-origin URL `http://localhost:3001` (from origin `http://localhost:3000`) with `credentials: 'include'`. The API never calls `app.enableCors()` (or equivalent) and there is no reverse proxy/Next.js rewrite in the compose stack or `next.config.ts`. Browsers therefore block reading the responses (preflight failure for the `application/json` POSTs; missing `Access-Control-Allow-Origin` for GET), so the new register/login pages render "Der Anmeldedienst ist derzeit nicht verfügbar" and `useCurrentUser` always resolves `user=null`. This affects every AP-16 web flow and is invisible to the curl-based smoke test and to the unit suite. (The pattern is pre-existing platform-wide, but the AP-16 register/login/approval UI depends on it, and AGENTS.md requires `docker compose up --build` to work from a fresh clone.)
  - Required fix: Enable CORS on the API restricted to the configured web origin(s) with `credentials: true` (and document the variable in `.env.example`/`docs/08` per the Future-Feature Contract), or serve the API through a same-origin path/rewrite; verify with a real-browser/headless check in the smoke or CI pipeline.

- [Minor] `apps/api/src/features/identity/auth.controller.ts:98-104` — register catch-block only counts `ConflictException`; comment overstates the counting
  - Evidence: The comment states "Fehlgeschlagene Versuche zaehlen mit (Brute-Force-/Enumeration-Schutz)", but only the `ConflictException` (P2002 username-taken) path calls `recordAttempt`. Validation 400s and unexpected errors are not counted. Behavior is still reasonable (the 409 is the enumeration signal; docs/07 §78 matches), so this is a comment/behavior mismatch, not a functional defect.
  - Required fix: Either record non-validation failures as well, or reword the comment to state that only conflict (enumeration) attempts count.

- [Minor] `apps/web/src/hooks/use-current-user.ts:27-55` + `apps/web/src/app/settings/page.tsx:13` + `apps/web/src/components/ui/app-shell.tsx:29` — duplicate `/auth/me` requests per page view
  - Evidence: The settings page instantiates `useCurrentUser` at page level and `AppShell` instantiates a second independent instance; both fire a parallel `fetch('/auth/me')` on mount (the AppShell is rendered inside the same page). Same for admin pages. No shared cache/store exists. This doubles auth calls on every shell page.
  - Required fix: Lift the user fetch to a shared context/provider or pass the resolved user into `AppShell`, and drop the page-level hook duplicate.

- [Minor] `prisma/migrations/20260731120000_ap16_global_roles_local_registration/migration.sql:37-49` + `apps/api/src/features/identity/auth.dto.ts:9-11` — email/OIDC-subject-derived backfilled usernames longer than 32 characters can never log in
  - Evidence: The migration backfills `username` from the full email or `oidcSubject` verbatim (lowercased/trimmed), but the login DTO `LocalLoginDto.username` is `@Length(3, 32)`. A pre-existing email longer than 32 chars (e.g. a long local-part) or a long OIDC subject yields a username that the API rejects with 400 before the lookup runs, permanently locking that migrated user out of local login. (Registration-regex characters such as `@` are harmless for login since the DTO only checks length.) New registrations are unaffected.
  - Required fix: In the migration, truncate/derive backfilled usernames to ≤32 chars (and to the `[a-z0-9._-]` charset, e.g. by slugifying) while preserving uniqueness, or relax the login DTO length to match the stored format.

- [Minor] `apps/web/src/app/(auth)/login/page.tsx:62-63` — `redirectTo` query parameter from the middleware is ignored
  - Evidence: `apps/web/src/middleware.ts:19` appends `?redirectTo=<pathname>` when redirecting unauthenticated users, but a successful login always does `window.location.href = '/'`, discarding the original destination.
  - Required fix: Read `redirectTo` from the URL on the login page and honor it (sanitized to an internal path) after a successful login.

- [Minor] `apps/api/src/features/identity/auth.controller.ts:160-181` — rate-limit counter is reset before session regeneration
  - Evidence: `await this.rateLimiter.resetAttempts(ip)` (line 161) runs before `req.session.regenerate(...)` (line 163). If regeneration fails (500), the counter has already been cleared, so an attacker who just hit the lockout could continue after the 500. Low risk (regenerate failure is rare), but the order is wrong.
  - Required fix: Perform the reset inside the regeneration callback (only on success), or move it after the session is confirmed.

## Verification
- Tests/checks reviewed: none executed (read-only environment). The implementer reports the canonical docker-compose contract green (prisma migrate deploy, lint, typecheck, 33 API test files / 398 tests) and `./scripts/compose-smoke-test.sh --build` green; these claims were not re-run. Test specs inspected: auth.controller.spec (register 429/409-counting/scope, localLogin generic 401/429/400/200/reset, callback session rotation, logout), user-admin.service.spec (approve/reject/disable/enable/setRole/bind/unbind, last-admin protection, P2034 bounded retry both paths), roles.guard.spec (min-rank semantics, READ_ONLY vs write routes), household-membership.guard.spec + household-isolation.integration.spec, login-rate-limiter.service.spec (register scope separation, fail-open), password-hashing.spec, local-admin.bootstrap.spec, identity.module.spec, app-config.schema.spec (LOCAL_AUTH/OIDC/TRUST_PROXY defaults). Coverage is adequate for register/approve/login/READ_ONLY-isolation/P2034/rate-limit scope; no spec exercises the OIDC strategy.
- Areas inspected: both AP-16 migrations (20260731120000 global-roles, 20260801120000 ai_extraction_jobs drift), full identity feature, main.ts (trust proxy, session/cookie flags), app-config schema+spec, docker-compose(.override/.test).yml, .env.example, compose-smoke-test.sh, next.config.ts, web middleware/hooks/pages, docs 07/08, ADR-007, README.
- Checked and found correct: round-2 READ_ONLY demotion fix (migration.sql:124-134); collision-resolution loop (migration.sql:67-98, correct termination via 6 guard rounds appending ever-longer unique-id prefixes, RAISE fallback); username backfill priority order and role derivation order (ADMIN pass before READ_ONLY pass, `oidcIssuer='local'` ADMIN promotion before placeholder NULLing); `users_oidcIssuer_oidcSubject_key` composite unique index already created by migration 20260728201425 (no drift); `users_email_key`/`credentials_identifier_key` DROPs match plain indexes created in AP-2/AP-14; ai_extraction_jobs drift migration matches the Prisma model exactly (columns, defaults, indexes, FK ON DELETE/UPDATE CASCADE); last-admin protection in a serializable transaction with bounded P2034 retry; self-disable blocked; `SetUserRoleDto` `@IsEnum(GlobalRole)` and `BindOidcIdentityDto` URL/length validation; rate-limiter fail-open on Redis errors (matches docs/07); session regeneration on login/OIDC callback and destroy on logout; bcrypt cost-12, no plaintext; generic login errors; PENDING_APPROVAL/DISABLED rejected by SessionAuthGuard; RolesGuard min-rank semantics (no escalation/lockout); audit redaction; bootstrap env-gated, idempotent, production-skipped, P2002-tolerant; Future-Feature Contract satisfied for TRUST_PROXY/LOCAL_AUTH_*/OIDC_* (.env.example, docker-compose.yml api+worker, app-config schema, docs 07/08, smoke-test passthrough).
- Remaining risks (not verifiable within this pass): real-browser verification of the web→API cross-origin path (CORS, finding M2); runtime behavior of the OIDC strategy against openid-client 6.8+ (finding M1); audit admin controller role gating and worker processor DB path beyond the smoke-test tolerant path; README consistency with the role model (already updated per review-2).

## Severity counts (one line)
Critical: 0, High: 0, Medium: 2, Minor: 5 — Verdict: CHANGES REQUIRED
