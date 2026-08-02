# AP-21 Review – Iteration 4

> Unabhängiges, read-only Abschluss-Review durch den `code-reviewer`-Subagenten
> (Session `ses_03e16b55effeS85TMoLZwmARMs`). Wortgetreue Kopie des
> Review-Ergebnisses.

## Review result
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: APPROVED

## Findings

- No findings.

## Areas verified as correct

- **Fix #1 — `apps/web/src/app/admin/settings/page.tsx:109-114`** — The mount
  effect is now `useEffect(() => { loadEntries(); }, [])` with a German
  comment documenting why `t` is intentionally excluded from the dependency
  array (a language switch creates a new `t` reference that would otherwise
  trigger a redundant `GET /admin/system-config`). The fix matches the
  round-3 Minor #1 suggestion exactly.
  - **No lint hazard:** `eslint.config.mjs` (repo root, the only ESLint
    config) contains no `react-hooks` plugin and no
    `react-hooks/exhaustive-deps` rule — confirmed at lines 4-24. The claim
    in the work package is accurate.
  - **No guard hazard:** the new comment contains German words, but
    `apps/web/scripts/check-hardcoded-german.mjs` strips comments before
    scanning (`stripCommentsKeepLines`, lines 63-126), so the i18n guard is
    unaffected (guard reported green in the executed verification).
  - **Behavioral trade-off is as documented:** `loadEntries` closes over the
    first-render `t`, so the error message (`admin.settings.errorLoading`)
    and the 401/403 redirect logic use the initial server-resolved language.
    Data values (keys, descriptions, reasons, validation hints) are
    server-catalog metadata and language-independent; all reactive UI
    text/dates in `SettingRow` use the row-local `useI18n()` (`t`/`language`
    re-render on switch, e.g. lines 376, 452, 466). The same pattern is
    already used consistently in
    `apps/web/src/app/settings/page.tsx:58-67` — no regression.
- **Fix #2 — `docs/adr/ADR-009-multi-language-support.md:86-101`** —
  Documentation-only changes are present and accurate:
  - READ_ONLY bullet (lines 86-91) now notes the short flash of a leftover
    cookie language before the endpoint sets the session language and deletes
    the cookie. Consistent with `i18n-context.tsx:71-83` (`applyLanguage`
    with `persistence === 'session'` calls `writeLanguageCookie(null)`).
  - Guest bullet (lines 92-101) now documents that a stale `versigo:locale`
    cookie from a prior persistent session is inherited by guests until
    sign-in/logout/cookie deletion, and correctly explains why
    (`layout.tsx:65-69` resolves the cookie for all visitors without a
    session round-trip). Matches code behavior: guests get a 401 on
    `GET /user/language` (`language-client.ts:22-24` returns null), so
    `applyLanguage`/`writeLanguageCookie` never fires and the stale cookie
    persists.
- **AP-21 spot-checks (unchanged by this round, still correct):**
  - English global default + fallback chain `selected → en → raw key`:
    `i18n/core.ts:23, 87-99`.
  - Resolution order stored/session → Accept-Language → en:
    `language.service.ts:39-65`; session-only READ_ONLY persistence
    (`language.service.ts:87-91`, never DB).
  - `users.locale` persistent for USER/ADMIN: `language.service.ts:94-98`;
    migration
    `20260802120000_ap21_multi_language_support/migration.sql` normalizes
    legacy locales to `'en'`, sets default `'en'`, and deletes obsolete
    `user_preferences` `language` rows.
  - READ_ONLY must not gain profile/preferences access:
    `profile.controller.ts:18` and `user-preferences.controller.ts:29` use
    `@Roles(GlobalRole.USER)`; the hierarchical `roles.guard.ts`
    (READ_ONLY=1, USER=2, ADMIN=3) yields 403 for READ_ONLY. The language
    endpoint is `@Roles(GlobalRole.READ_ONLY)` → minimum rank 1, so all
    authenticated roles pass — correct. Spec `language.controller.spec.ts`
    asserts the READ_ONLY metadata.
  - Login/register pages localize API errors via HTTP status
    (`auth-errors.ts` — 409→`usernameTaken`, 501→`registrationDisabled`
    correct; `login/page.tsx:102`, `register/page.tsx:50`), no raw German API
    messages surfaced.
  - Numbers/currencies/dates follow active language: `format.ts` (de-DE/
    en-GB, EUR), used in `policies/[id]/costs/page.tsx`
    (`formatCurrency`/`formatDate` with `language`).
  - No new third-party i18n dependency; custom type-safe `t()`; i18n guard
    wired in `docker-compose.test.yml:59-60` and `apps/web/package.json`
    (`test:i18n`).
  - Compose/smoke-test contract: covered by the executed canonical gate and
    `compose-smoke-test.sh` steps 8n/8o/9b (documented in
    ADR-009:122-123).

## Remaining risks / not yet verified

- **Static review only of the two fixes; gates not re-executed in this
  read-only session.** The work package's executed verification (web tsc;
  ESLint web/api/worker; vitest web 42/42, api 585, worker 4, foundation 91;
  i18n guard 44 files; canonical compose gate "All checks passed!";
  `compose-smoke-test.sh --build` "All smoke tests passed") was taken as
  stated, consistent with prior rounds. Both fixes are code/doc-local and
  cannot affect API, worker, or foundation suites.
- **Stale-`t` error message in `loadEntries` (Fix #1 trade-off):** if the
  admin switches language before a fetch error occurs, the error text appears
  in the initial (cookie-resolved) language. This is a cosmetic edge case,
  explicitly documented in the code comment and accepted in round 3.
- **Server-catalog descriptions/reasons render untranslated** (e.g.
  `admin/settings/page.tsx:399,463`, costs frequency fallback `??` at
  `policies/[id]/costs/page.tsx:141,173`): pre-existing design (server
  catalog metadata is the source of truth), not introduced or affected by
  this round.

## Resolution notes (Round 4)
- Acceptance condition fully met (0/0/0/0). No further fixes required.
- Verification re-run after the round-3 fixes: web tsc, ESLint web, vitest
  web 42/42, i18n guard (44 Dateien) — all green. Canonical gates were
  already re-run after the round-2 fixes and the round-4 changes are
  code/doc-local (admin/settings effect deps + ADR wording), so they cannot
  affect the API/worker/foundation suites.
