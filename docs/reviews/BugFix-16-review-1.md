# BugFix-16 Review – Runde 1

Datum: 2026-08-09
Geprüfte Änderungen: uncommitted Diff (BugFix-16: Passwort-Änderung für den eingeloggten Benutzer + Admin-Passwort-Reset)

## Verbatim-Ergebnis des code-reviewer

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 4
- Verdict: CHANGES REQUIRED

## Findings

- [Medium] `apps/api/src/features/identity/auth.controller.ts:390` (service: `apps/api/src/features/identity/auth.service.ts:291`) — No rate limiting on current-password verification in POST /auth/change-password
  - Evidence: The endpoint verifies the current password against the bcrypt hash but never consults `LoginRateLimiterService` (which is applied to `/auth/local/login` and `/auth/register`). An attacker who has obtained a valid session (stolen cookie, shared computer, XSS) can brute-force the current password without any throttling, enabling password-reuse attacks. The login endpoint is rate-limited for exactly this reason, so the new password-verification surface is an inconsistency with the project's own brute-force protection.
  - Required fix: Apply the existing `LoginRateLimiterService` (or a dedicated scope) to failed current-password verifications in `changePassword` — record attempts on 403 and check `isBlocked` before verifying, mirroring the login flow.

- [Minor] `apps/web/src/app/admin/users/page.tsx:144-147` — Reset-password dialog shows raw English API messages for 409/404
  - Evidence: `submitReset` uses `data?.message ?? t('admin.users.resetPasswordFailed')`. A 409 ("Account has no local password") or 404 would render the raw English API message in the German UI. The settings page (line 197-202) maps 403/409 to localized keys; the admin page does not, so the two flows are inconsistent.
  - Required fix: Map 409 (and 404) to localized catalog keys (e.g. reuse `settings.pwNoLocalCredential` or add `admin.users.resetPasswordNoCredential`), falling back to `resetPasswordFailed` only for other statuses.

- [Minor] `apps/web/src/app/settings/page.tsx:195-203` — change-password handler does not handle 401 (session expiry)
  - Evidence: `handleChangePassword` only maps 403 and 409; a 401 falls through to `data?.message ?? t('settings.pwChangeError')`, displaying the raw English "No valid session" message. Every other handler on the page (`loadProfile`, `loadOidcStatus`, `handleExport`) redirects to `/login` on 401.
  - Required fix: Add a `res.status === 401` branch that redirects to `/login`, consistent with the other handlers.

- [Minor] `apps/api/src/features/identity/auth.dto.ts:44-46` — currentPassword validation message is misleading for the upper bound
  - Evidence: `@Length(1, PASSWORD_MAX_LENGTH, { message: 'currentPassword must not be empty' })` — a currentPassword longer than 128 characters would produce the message "must not be empty", which is incorrect.
  - Required fix: Use a message covering both bounds, e.g. `currentPassword must be between 1 and 128 characters long`.

- [Minor] `apps/api/src/features/identity/user-admin.service.ts:324` — bcrypt hashing runs inside the DB transaction
  - Evidence: `const passwordHash = await this.passwordHashing.hash(newPassword);` executes inside the `$transaction` callback. bcrypt cost 12 takes ~250 ms, holding the transaction (and its DB connection) open during hashing. The hash does not depend on any transaction state and could be computed before the transaction starts.
  - Required fix: Compute the hash before opening the transaction and pass the resulting hash into the callback.

## Verification
- Tests or checks reviewed:
  - `auth.controller.spec.ts` — changePassword delegation and 403/409 propagation (mock added to `AuthServiceLike`).
  - `auth.service.spec.ts` — changePassword success/403/404/409, audit entries never contain the password or hash.
  - `user-admin.service.spec.ts` — resetPassword success/404/409, constructor extended with `PasswordHashingService` mock, audit never contains the password.
  - `i18n.spec.ts` parity test (en/de key-tree equality) and `check-hardcoded-german.mjs` guard — new keys exist in both catalogs; no hardcoded German UI text introduced; `Dialog` now uses `t('common.cancel')`.
- Important areas inspected:
  - Guards: `SessionAuthGuard` (authenticated, ACTIVE-only) and `RolesGuard` (`@Roles(GlobalRole.ADMIN)` on `UserAdminController` → global admins only) — both endpoints correctly protected; `changePassword` has no `@Public()`.
  - DTOs: `ChangePasswordDto` (currentPassword 1..128, newPassword 12..128) and `ResetUserPasswordDto` (12..128) match the spec.
  - Audit: `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILURE`, `USER_PASSWORD_RESET` all written with empty `{}` diffs; no password/hash in any audit path; `auditSelf`/`audit` are fail-soft.
  - Prisma schema: `Credential.userId` is `@unique`, so `credential.update({ where: { userId } })` is valid.
  - Session cookie: `sameSite: 'lax'` + `httpOnly` — CSRF on the new POST endpoints is mitigated.
  - Web: settings form (mismatch check, 403/409 mapping, success message, field clearing) and admin dialog (button gated on `hasCredential`, min-12 client check, POST + list reload, success/error alerts) match the spec.
- Remaining risks:
  - No rate limiting on the change-password endpoint (finding 1).
  - The 404 path in `changePassword` is defensive only — `SessionAuthGuard.findById` already rejects missing users with 401 before the controller runs.
  - No e2e/integration test for the two new HTTP routes (unit tests only).

FINAL: 0 Critical / 0 High / 1 Medium / 4 Minor
