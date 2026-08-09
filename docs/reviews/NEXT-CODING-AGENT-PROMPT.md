# NEXT-CODING-AGENT-PROMPT.md

## Project state after BugFix-16 (password change + admin password reset)

BugFix-16 was a direct user request with no prompt file (work package: "Passwort
ändern für den eingeloggten Benutzer" + "Admin-Passwort-Reset"). It is
implemented, reviewed (5 review rounds, acceptance condition met on round 5:
0 Critical / 0 High / 0 Medium / 2 Minor, both Minors fixed after the final
review and re-verified; see `docs/reviews/BugFix-16-review-1.md` and
`docs/reviews/BugFix-16-review-5.md`), and committed on branch
`fix/BugFix-09-ci-fix-community-standards-dockerhub` (commit `d74ba53`).

Package BugFix-16 delivered:

1. **`POST /auth/change-password`** (HTTP 204, authenticated, no `@Public`):
   verifies the current password via bcrypt, maps 403 ("Current password is
   incorrect") / 404 / 409 ("Account has no local password", OIDC-only) to
   generic errors, audits `PASSWORD_CHANGED` / `PASSWORD_CHANGE_FAILURE`
   without any password material, and is rate-limited in a dedicated Redis
   scope `'change-password'` (`isBlocked` → 429, `recordAttempt` on 403,
   `resetAttempts` on success) via `LoginRateLimiterService`.
2. **`POST /admin/users/:id/reset-password`** (HTTP 204, ADMIN only):
   computes the bcrypt hash BEFORE the `$transaction` (cost 12 ~250 ms never
   inside the transaction), updates the credential hash, audits
   `USER_PASSWORD_RESET` with empty diff. JSDoc + docs state that the reset
   does NOT revoke existing sessions — to force re-auth, lock the account.
3. **DTOs**: `ChangePasswordDto` (currentPassword 1..128 with honest message,
   newPassword 12..128) and `ResetUserPasswordDto` (12..128), both using
   exported `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH`; global
   `ValidationPipe` (whitelist + forbidNonWhitelisted) applies.
4. **Web**: `/settings` (Tab "Profil") password-change form (current/new/
   confirm, min 12, mismatch check, 401 → `/login`, localized errors incl.
   429 → `auth.rateLimited`, success clears the fields); `/admin/users`
   reset dialog (button only when `hasCredential`, second confirm field with
   mismatch check, 401 → `/login`, 409 → `resetPasswordNoCredential`).
   `dialog.tsx` cancel button localized via `t('common.cancel')` (i18n guard).
5. **i18n**: all `settings.pw*` and `admin.users.resetPassword*` keys added in
   `en.ts`/`de.ts` (parity test green); unused `resetPasswordConfirm` key
   removed.
6. **Docs**: `docs/08-admin-operations.md` (Betriebshinweise + API-table row
   for the reset endpoint), `docs/ui-control-matrix.md` (2 new rows:
   "Passwort ändern", "Admin: Passwort zurücksetzen"),
   `docs/07-security-privacy.md` (Brute-Force-Schutz now documents the
   `change-password` scope).
7. **Tests**: `auth.controller.spec.ts`, `auth.service.spec.ts`,
   `user-admin.service.spec.ts`, `login-rate-limiter.service.spec.ts`
   extended (delegation, 403/404/409, audit-without-password, 429 short-
   circuit with `toMatchObject`, hash-not-computed-on-409, change-password
   scope key).

**Review loop history (5 rounds, max reached, acceptance met):**
0/0/1/4 → 0/0/0/4 → 0/0/0/2 → 0/0/0/2 → 0/0/0/2 (PASS, "acceptable for
commit"). Round-5 Minors (security doc missing the new scope, `submitReset`
lacking 401 handling) were fixed after the review; the full test gate was
re-run green afterwards.

**Verification state of the BugFix-16 commit (`d74ba53`):**
- Full compose test gate (container, `docker compose -p versigo-test -f
  docker-compose.test.yml up --build --abort-on-container-exit
  --exit-code-from test`): Prisma migrate deploy, lint, typecheck, tests
  (API 58 files / 672 tests), license check (578 packages, OK), i18n guard
  (OK) → "All checks passed!".

## No next work package exists

`prompts/` contains no further numbered work package after BugFix-11 (last
file `prompts/BugFix-11-release-readiness.md`). BugFix-12 through BugFix-16
were direct user requests without prompt files, all committed:
- BugFix-12 (`f6ffeb7`): third-party license compliance.
- BugFix-13 (`d6afe07`): single source for public URLs (VERSIGO_HOST +
  APP_PORT/WEB_PORT derive NEXT_PUBLIC_API_BASE_URL, CORS_ORIGINS,
  OIDC_CALLBACK_URL).
- BugFix-14 (`0e29c02`): dual access with one deployment (per-request cookie
  `Secure` flag 'auto', web entrypoint auto-detects API base URL).
- BugFix-15 (`4360b65`): curl-based compose healthchecks.
- BugFix-16 (`d74ba53`): this package.

**A new coding-agent session must therefore NOT auto-start any work package.**
Wait for the user's next explicit instruction. If the user provides a new
numbered prompt file in `prompts/` (or a direct request), implement only that
one and use the same review loop: invoke the `code-reviewer` subagent via the
Task tool on the uncommitted diff, write each report verbatim to
`docs/reviews/<package>-review-<n>.md`, fix every Critical/High/Medium and
Minor where reasonable until 0 Critical / 0 High / 0 Medium / ≤ 8 Minor, max
5 review rounds, then commit with a message starting with the package number
and write a new handoff (this file).

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
- Node/pnpm are NOT on the host PATH; run gates via the test container.
- The `auth.service.ts ↔ oidc.strategy.ts` cycle is load-order fragile: a
  full API boot (real Nest bootstrap) is the ONLY check that proves it; the
  unit suites cannot.
- Disk on `/var/home` is ~123 GB and fills quickly (was at 68% / 40 GB free
  at the end of BugFix-16). `podman system prune -a -f` before large
  rebuilds. Never redirect podman storage. Clean up all podman artifacts
  created during a session (test stack down -v, `localhost/versigo-test`
  image, scratch containers/volumes/files) before the commit and verify
  `df -h /var/home` afterwards (AGENTS.md point 9).
