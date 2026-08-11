# BugFix-16 Review – Runde 5

Datum: 2026-08-09
Geprüfte Änderungen: uncommitted Diff (BugFix-16: Passwort-Änderung für den eingeloggten Benutzer + Admin-Passwort-Reset) – Fokus auf Runde-4-Fixes (JSDoc/Doku) und UI-Control-Matrix-Zeilen

## Verbatim-Ergebnis des code-reviewer

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings

- [Minor] `docs/07-security-privacy.md:76-82` — Brute-Force-Schutz section does not document the new `change-password` rate limit
  - Evidence: The work package adds per-IP rate limiting with a dedicated Redis scope `"change-password"` to `POST /auth/change-password` (`apps/api/src/features/identity/auth.controller.ts:401-424`). The security doc's "Brute-Force-Schutz" section documents the login counter (line 77-79) and the register counter (line 80), but the change-password counter — a new, security-relevant brute-force surface — is absent. It is documented only in `docs/ui-control-matrix.md:37` and the controller JSDoc (auth.controller.ts:386-393), so the canonical security document is incomplete.
  - Required fix: Add a bullet to the "Brute-Force-Schutz" section noting that failed current-password verifications on `POST /auth/change-password` are counted per IP in a separate scope (`change-password`) and that the counter is reset on success.

- [Minor] `apps/web/src/app/admin/users/page.tsx:150-159` — `submitReset` does not handle 401 (session expiry)
  - Evidence: If the admin's session expires while the reset dialog is open, the POST returns 401 and the code falls through to the generic localized `t('admin.users.resetPasswordFailed')` — the admin sees a misleading "reset failed" instead of being redirected to `/login`. The settings page's new `handleChangePassword` handles exactly this case (`apps/web/src/app/settings/page.tsx:196-199` redirects on 401), so the two flows remain inconsistent. (Note: the impact is limited to UX — unlike `runAction` on the same page, `submitReset` never leaks a raw English API message because it maps by status; the gap is consistent with the page's pre-existing `runAction` pattern, which also lacks 401 handling.)
  - Required fix: Add a `res.status === 401` branch in `submitReset` that redirects to `/login`, mirroring `handleChangePassword` and `loadUsers` on the same page.

## Verification

### Previous round-4 findings — both properly addressed
1. **Session revocation not documented — FIXED and accurate.** The JSDoc on `user-admin.service.ts:311-313` explicitly documents that the reset does NOT revoke existing sessions and that disabling the account forces re-auth; `docs/08-admin-operations.md:80` (Betriebshinweise) and `:102` (API table row) state the same; `docs/ui-control-matrix.md:34` notes "Sessions werden nicht widerrufen". These claims match the actual behavior: `SessionAuthGuard` (auth.guard.ts:38-41) validates only existence + `ACTIVE` status, so a changed password never invalidates sessions and disabling an account (`DISABLED`) rejects existing sessions immediately.
2. **New endpoints missing from docs — FIXED and accurate.** `docs/08-admin-operations.md:102` gained the `POST /admin/users/:id/reset-password` row (role `ADMIN`, audit `USER_PASSWORD_RESET`, 409 for OIDC-only, session note — all match user-admin.controller.ts:84-92 and user-admin.service.ts:315-337); `docs/ui-control-matrix.md:34` (Admin reset) and `:37` (Passwort ändern) match the implemented UI/API behavior (button gated on `hasCredential` at page.tsx:314-318, 409→localized key, mismatch check, 429 mapping, 401 redirect on the settings page).

### Round-1 findings — all fixed and verified
- **Medium (no rate limiting on change-password): FIXED.** `auth.controller.ts:401-424` checks `isBlocked(ip,'change-password')`, records on `ForbiddenException`, resets on success; scope union extended in `login-rate-limiter.service.ts:36,49,72,87`; JSDoc and spec updated. 429 message is generic.
- **Minor (raw English 409/404 in admin dialog): FIXED** (page.tsx:155-158 maps 409 and falls back to localized text).
- **Minor (settings 401 handling): FIXED** (page.tsx:196-199).
- **Minor (misleading currentPassword message): FIXED** (auth.dto.ts:44-46 now "between 1 and 128").
- **Minor (bcrypt inside transaction): FIXED** — `user-admin.service.ts:320` computes the hash before `$transaction` opens; `changePassword` uses no transaction at all.

### Tests reviewed
- `auth.controller.spec.ts:667-744` — delegation, 403 propagation + attempt recording, 409 without counting, 429 short-circuit (service untouched).
- `auth.service.spec.ts:381-457` — success/403/404/409, audit never contains password or hash.
- `user-admin.service.spec.ts:459-503` — success (audit `USER_PASSWORD_RESET`, no plaintext), 404, 409, update not called on 409.
- `login-rate-limiter.service.spec.ts:90-103` — `change-password` scope key `change-password:attempts:{ip}`.
- i18n parity (`apps/web/src/__tests__/i18n.spec.ts:91` key-tree equality) and the hardcoded-German guard: all new keys exist in both `en.ts`/`de.ts`; no hardcoded German UI strings introduced (all UI text via `t()`).

### Important areas inspected
- Guards: `SessionAuthGuard` (authenticated, ACTIVE-only) + `RolesGuard` (`@Roles(GlobalRole.ADMIN)` on `UserAdminController`) — both new endpoints correctly protected; `change-password` has no `@Public()`.
- DTOs: `ChangePasswordDto` (1..128 / 12..128) and `ResetUserPasswordDto` (12..128) match the policy; global `ValidationPipe` (whitelist + forbidNonWhitelisted) runs before the controller.
- Audits: `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILURE`, `USER_PASSWORD_RESET` all written with empty `{}` diffs; no password/hash in any audit path; fail-soft.
- Prisma: `Credential.userId` is `@unique` (schema.prisma:102), so `credential.update({ where: { userId } })` is valid.
- Rate-limit semantics: 5 attempts allowed, 6th blocked (count ≥ max), reset on success — mirrors `localLogin`; per-IP tradeoff consistent with login; fail-open on Redis errors.
- Session cookie: `sameSite:'lax'` + `httpOnly` (main.ts:118,109) — CSRF on the new POST endpoints mitigated.
- Documentation accuracy of the new rows (compared against code): all statements verified correct, including the session-revocation wording.

### Remaining risks
- No e2e/integration test for the two new HTTP routes (unit tests only) — pre-existing project-wide approach, not blocking.
- The per-IP `change-password` counter is shared across users behind the same NAT IP (same tradeoff as login) — acceptable per project convention.
- The admin page's `runAction` (pre-existing, not part of this package) still renders raw English API messages on 401; only the new `submitReset` was assessed here.

The change is **acceptable for commit** (0 Critical / 0 High / 0 Medium / 2 Minor).

## Nachbereitung der Minor-Findings (durch den Agenten)
- `docs/07-security-privacy.md`: Bullet zum `change-password`-Scope im Abschnitt „Brute-Force-Schutz" ergänzt.
- `apps/web/src/app/admin/users/page.tsx`: `submitReset` leitet bei 401 zu `/login` weiter (konsistent zu `handleChangePassword`/`loadUsers`).
- Vollständiger Check-Zyklus nach den Fixes erneut grün (58 Test-Files, 672 Tests, License-Check 578 Pakete, i18n-Guard; „All checks passed!").

FINAL: 0 Critical / 0 High / 0 Medium / 2 Minor — ACCEPTED
