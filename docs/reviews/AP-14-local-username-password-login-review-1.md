# Review result — Round 1

## Summary
- Critical: 0
- High: 1
- Medium: 2
- Minor: 3
- Verdict: **CHANGES REQUIRED**

## Findings

### High

- [High] `apps/api/src/features/identity/__tests__/login-rate-limiter.service.spec.ts:48-54` — Test mock typo causes false-positive test failure for `recordAttempt`
  - **Evidence:** The mock object assigned to `service.client` in the test "erhoeht den Zaehler fuer eine IP" (line 48-54) defines `pexiretime` (typo), while the implementation at `login-rate-limiter.service.ts:47` calls `this.client.pexpire()`. Because `pexpire` is undefined on the mock, calling it throws `TypeError`. The test expects the promise to resolve to `1`, but it will reject, causing this test to fail.
  - **Required fix:** Change `pexiretime` to `pexpire` in the mock object at line 50 and also in the top-level `vi.mock` default factory at line 10.

### Medium

- [Medium] `apps/api/src/features/identity/auth.controller.ts` and `apps/api/src/features/identity/auth.service.ts` — No audit-log records created for local login events
  - **Evidence:** Work package scope item 3 requires "audit logging" for the credential lifecycle. The security documentation (`docs/07-security-privacy.md` line 59–62) states: "Erfolgreiche und fehlgeschlagene lokale Login-Versuche werden auditierbar erfasst" — but neither `AuthController.localLogin` nor `AuthService.localLogin` writes to the `AuditEvent` table. Only a `Logger.warn` call exists for disabled-user attempts, which is not persistent audit logging. This is a material gap against both the scope and the documented security posture.
  - **Required fix:** Add `AuditEvent` creation (via `DatabaseService`) for successful and failed local login attempts, excluding plaintext passwords and identifiers from the diff/context fields as documented.

- [Medium] `apps/api/src/features/identity/login-rate-limiter.service.ts:22-31` — Redis connection created without lifecycle management (potential resource leak)
  - **Evidence:** The `LoginRateLimiterService` constructor creates a new Redis client via `new Redis(config.redisUrl, ...)`. The class does not implement `OnModuleDestroy` or `OnApplicationShutdown` from `@nestjs/common`, so the connection is never explicitly closed when the application shuts down. In containerized or long-running environments this can cause connection leaks on the Redis server.
  - **Required fix:** Implement `OnApplicationShutdown` (or use `OnModuleDestroy`) in `LoginRateLimiterService` and call `await this.client.quit()` to close the Redis connection gracefully.

### Minor

- [Minor] `apps/api/src/features/identity/auth.controller.ts:66` — `@HttpCode(200)` decorator is redundant when using `@Res()` (Express response mode)
  - **Evidence:** The `localLogin` method injects `@Res()`, which puts NestJS into Express response-handling mode, bypassing the `@HttpCode` decorator entirely. The explicit `res.status(200).json(...)` call at line 118 is the effective status setter. The decorator is misleading and should be removed.
  - **Required fix:** Remove the `@HttpCode(200)` decorator from the `localLogin` method since it has no effect when `@Res()` is used.

- [Minor] `apps/api/src/features/identity/login-rate-limiter.service.ts:44-47` — Potential untracked Redis key if `pexpire` fails after `incr` succeeds
  - **Evidence:** In `recordAttempt`, the `incr` call succeeds (returning `1`), but if the subsequent `pexpire` call fails (Redis transient error, timeout), the key persists without a TTL. This would cause it to permanently block the IP until Redis key eviction. The `catch` block only returns the count but does not handle a partial write.
  - **Required fix:** In the `count === 1` branch, either wrap both operations in a Redis MULTI/EXEC transaction or add a fallback that deletes the key if `pexpire` fails, to avoid a permanently rate-limited key.

- [Minor] `apps/api/src/features/identity/__tests__/auth.controller.spec.ts` — Missing test for `GET /auth/login` (OIDC redirect) preservation
  - **Evidence:** The work package requires "OIDC sign-in remains functional and unchanged." The existing OIDC `GET /auth/login` endpoint is preserved in the controller, but there is no test verifying that the OIDC redirect still works when local auth is enabled or disabled. The existing `callback` test at line 117 only tests the callback path.
  - **Required fix:** Add a test case for `GET /auth/login` (the OIDC redirect) that verifies it still returns a redirect and sets session values, ensuring no regression from the AP-14 changes.

## Verification

- **Tests reviewed:** `password-hashing.service.spec.ts`, `login-rate-limiter.service.spec.ts`, `auth.controller.spec.ts`, `auth.service.spec.ts`, `household-isolation.integration.spec.ts`, `capability-flags.service.spec.ts`
- **Security-critical areas inspected:** Password hashing (bcrypt, cost 12, unique salt), generic error messages (401/429), rate limiting (Redis-based, IP-scoped, fail-open), session regeneration (fixation protection), environment-based capability gating (`LOCAL_AUTH_ENABLED`), startup validation (at least one auth method required)
- **Completeness check:** All primary scope items from the work package are addressed (Credential model, login endpoint, auth config endpoint, rate limiting, UI, Docker Compose, docs, ADR). The one material gap is the missing audit-log integration (Medium finding). The password-hashing ADR-006 is comprehensive.
- **Regression risk:** OIDC flow is structurally unchanged. The `AuthController.login()` and `callback()` methods are preserved. The `SessionAuthGuard` still checks the same `req.session.userId` path. Risk is low.
- **Remaining risks:** The test mock typo (High) means the rate limiter tests will fail; this must be fixed before the test suite can pass. The missing audit logging is a documented but unimplemented security requirement that should be addressed before release.
