# AP-21 Review – Iteration 3

> Unabhängiges, read-only Review durch den `code-reviewer`-Subagenten
> (Session `ses_03e1acfa5ffe6KxmmY3jJubiM4`). Wortgetreue Kopie des
> Review-Ergebnisses.

## Review result
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: APPROVED

## Findings

- [Minor] `apps/web/src/app/admin/settings/page.tsx:109` — admin settings re-fetch on every language change (round-2 fix applied inconsistently)
  - Evidence: `useEffect(() => { loadEntries(); }, [t]);` keeps `t` in the dependency array. Switching the UI language (an AP-21 feature) re-creates `t` (`useMemo` on `[language]` in `i18n-context.tsx:136`) and therefore triggers a redundant `GET /admin/system-config`. The round-2 Minor #7 fix removed exactly this pattern on the user settings page (`settings/page.tsx:58-67`, deps `[userLoading, user]`), but this file — which was modified in this package — still refetches all system settings on each language switch.
  - Required fix: Drop `t` from the dependency array (e.g. `useEffect(() => { loadEntries(); }, [])` with `loadEntries` wrapped in a stable callback, or keep the current pattern only if the refetch is intentional), matching the settings-page approach.

- [Minor] `apps/web/src/app/layout.tsx:65-69` + `docs/adr/ADR-009-multi-language-support.md:90-95` — ADR claim "guests always start with English" does not hold when a stale `versigo:locale` cookie exists
  - Evidence: The layout resolves `initialLanguage` from the `versigo:locale` cookie for every visitor, including unauthenticated guests. The cookie is set for persistent USER/ADMIN accounts with `max-age=31536000` (`i18n-context.tsx:50`) and is never cleared on logout (`auth.controller.ts:242-248` only clears `versigo.sid`). A guest on a browser that previously held a persistent German session will see the login/register pages rendered in German — the I18nProvider only reconciles with the server on `GET /user/language`, which returns 401 for guests (preference `null`, cookie language retained, `i18n-context.tsx:92-97`). This contradicts the ADR's documented design ("Login-/Registrierungsseiten starten bewusst mit dem globalen Default Englisch"). The same applies to the ADR's "kurzer englischer Flash" note for READ_ONLY: with a stale persistent cookie the flash is German, not English.
  - Required fix: Either clear/ignore the locale cookie for unauthenticated visitors (e.g. resolve the guest initial language to `DEFAULT_LANGUAGE` when no session exists) or amend the ADR to state that guests inherit a previously persisted cookie language until they sign out/clear it.

## Areas verified as correct
- **Round-2 Medium (register 501):** `auth.controller.ts:80-90` now throws `501 NOT_IMPLEMENTED` for disabled registration (mirroring login); `auth.controller.spec.ts:289-306` updated; `localizeAuthError` maps 501 → `registrationDisabled` distinctly from 409 → `usernameTaken`; the register page uses `localizeAuthError` and no longer can show "username taken" for the disabled case; `i18n-helpers.spec.ts:38-42` asserts the 501/409 distinction.
- **Round-2 Minors 1-8:** ADR-009 decision #4 + consequences rewritten (session-only READ_ONLY, no cookie, profile `locale` accepted but UI-unused, guest en default documented); `readLanguageCookie` fully removed (grep: zero matches); settings + admin/settings pages use shared `formatDate` from `i18n/format.ts`; new `i18n-helpers.spec.ts` (12 tests) covers `localizeAuthError` + `Intl` wrappers; settings effect deps are `[userLoading, user]` without `t`; `formatDate` returns `''` for null/undefined/empty and the raw value for unparseable input (all branches unit-tested).
- **New fixes:** `formatDate` signature `string | number | Date | null | undefined` is correct and safe (guards `NaN` before `Intl` call); `settings/page.tsx:156` and `admin/settings/page.tsx:461` consume it with the active `language`; the settings effect without `t` passes ESLint because the repo does not enable `react-hooks/exhaustive-deps` (confirmed in `eslint.config.mjs`), and the profile/date display re-renders correctly on language change via `useI18n` value identity.
- **Security — READ_ONLY isolation:** `LanguageService.resolveLanguage`/`setLanguage` never touch the DB for READ_ONLY (unit-tested, incl. "liest für READ_ONLY niemals die Datenbank"); `profile.controller.ts:18` and `user-preferences.controller.ts:29` remain `@Roles(GlobalRole.USER)` → 403 for READ_ONLY; `LanguageController` `@Roles(GlobalRole.READ_ONLY)` admits all roles via the minimum-rank `RolesGuard`; the READ_ONLY language is written only into the express-session and the web client actively deletes the cookie on session persistence (`writeLanguageCookie(null)`).
- **Session/cookie handling:** express-session (`saveUninitialized:false`) persists the mutated `session.language` within the session; smoke 8o verifies same-session GET-after-PUT, DB non-persistence (`users.locale` stays `en`), 403 on profile/preferences, and reset to `en` after logout+relogin.
- **`/user/language` API:** DTO `@IsIn(['en','de'])` under the global `ValidationPipe` (whitelist+transform) → 400 for invalid input (smoke 8n); q-value-aware `languageFromAcceptLanguage` with comprehensive constants tests; no role escalation (self-only, single field `users.locale`); CSRF posture consistent with the rest of the API (SameSite=lax session cookie + restricted CORS origins with `credentials:true`).
- **Migration & schema:** default changed to `'en'`, legacy values normalized, obsolete `user_preferences('language')` rows deleted; `schema.prisma:59` matches (`@default("en")`); `'language'` removed from `USER_PREFERENCE_CATALOG` and a test asserts it is rejected.
- **Contract:** No new third-party i18n dependency (`apps/web/package.json` unchanged: next/react/react-dom only); no new env vars/services; `docker-compose.test.yml` wires `test:i18n`; smoke steps 8n/8o/9b added and their shell logic is sound (fresh READ_ONLY user, cleanup, 401 for unauthenticated).
- **Docs:** ADR-009, `docs/03-architecture.md`, `docs/11-ui-ux.md`, `docs/13-settings-catalog.md` consistently describe the architecture, guard, and endpoint.

## Remaining risks / not yet verified
- I could not run `git diff`/`git status` (no shell tool); the review is based on the full current state of the listed files. Changes in files not enumerated in the work package (e.g. `app-shell.tsx`, `nav-config.tsx`, `appearance-settings.tsx`, `docker-compose.yml`, `.env.example`) were inspected only via grep and appear consistent, but their precise diffs were not confirmed.
- The reported canonical gate (`docker compose up --build` → "All checks passed") and `compose-smoke-test.sh` results were taken as stated; I did not execute them in this environment.
- Finding 2 (stale-cookie guest language) was reasoned about from the code; it was not runtime-verified against a browser session.
- Migration normalizes case-insensitively but leaves uppercase variants (`EN`, `De`) untouched in the DB; the API treats them as unsupported and falls back to `en`. The migration comment acknowledges this trade-off and legacy values are all lowercase, so no practical impact.

## Resolution notes (Round 3 fixes applied after this review)
- **Minor 1:** `admin/settings/page.tsx` effect deps changed to `[]` (no refetch on language switch); comment added.
- **Minor 2:** ADR-009 guest + READ_ONLY bullets amended to document the stale-cookie inheritance behavior.
