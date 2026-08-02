# AP-21 Review – Iteration 1

> Unabhängiges, read-only Review durch den `code-reviewer`-Subagenten
> (Session `ses_03e40e8cdffebUQl94ZcN0N52T`). Wortgetreue Kopie des
> Review-Ergebnisses.

## Review result

**Maximum steps reached:** I have exhausted the step budget for this review session and must stop making tool calls. Below is my report based on the files inspected so far, with clearly marked items that still require verification.

## Summary
- Critical: 0
- High: 0
- Medium: 4
- Minor: 4
- Verdict: CHANGES REQUIRED

## Findings

### Confirmed findings

- [Medium] `apps/web/src/app/(auth)/login/page.tsx:99,161` and `apps/web/src/app/(auth)/register/page.tsx:47` — Unlocalized German API error messages are rendered verbatim in the UI.
  - Evidence: The pages do `setError({ message: body.message ?? t(...) })` and render `{error.message}`. The API returns German-only messages (`auth.controller.ts:143` "Anmeldeversuch fehlgeschlagen…", `:152` "Benutzername und Passwort sind erforderlich", `:162` "Anmeldedaten sind ungueltig.", `:172` "Session-Fehler", `:81`/`:91` register/rate-limit messages). AP-21 scope explicitly covers "Login, Logout, lokale Authentifizierung … Session-Fehler" and "API-Fehlertexte, sofern diese direkt in der UI angezeigt werden". In an English UI these appear in German; the hardcoded-German guard cannot catch them (they live in `apps/api`).
  - Required fix: Map server error codes/statuses to localized keys in the UI (or return machine-readable codes from the API and translate client-side); do not display raw German `message` strings.

- [Medium] `apps/web/src/app/policies/page.tsx:88`, `apps/web/src/app/household/costs/page.tsx:74,102`, `apps/web/src/app/policies/[id]/page.tsx:131`, `apps/web/src/app/policies/[id]/costs/page.tsx:138,139,171,172` — Currency/amount formatting is not locale-aware.
  - Evidence: All amounts render as `value.toFixed(2) EUR` (fixed English decimal separator, hardcoded currency literal); `policies/[id]/page.tsx:131` renders a raw number. Acceptance criterion "Zahlen, Währungen … folgen der aktiven Sprache" is not met (German UI shows `1234.50 EUR` instead of `1.234,50 €`).
  - Required fix: Format amounts with the active locale (e.g. `Intl.NumberFormat` for the active language) and localize the currency symbol/position.

- [Medium] `apps/web/src/app/policies/[id]/page.tsx:119,124`, `apps/web/src/app/policies/[id]/costs/page.tsx:143,169,170` — Dates follow the browser locale, not the active UI language.
  - Evidence: `new Date(...).toLocaleDateString()` is called without a locale argument, while `settings/page.tsx:164` and `admin/settings/page.tsx:83` use `language === 'de' ? 'de-DE' : 'en-GB'`. A German UI on an English-locale browser shows English-format dates, violating "Datum … folgt der aktiven Sprache".
  - Required fix: Use a single shared date-formatting helper driven by the active language and apply it consistently.

- [Medium] `apps/web/src/i18n/i18n-context.tsx:72-74` — SSR/CSR hydration mismatch for users with a persisted `versigo:locale` cookie.
  - Evidence: The `useState` initializer reads the cookie on the client but returns `DEFAULT_LANGUAGE` ('en') during SSR, so the server HTML is rendered in English while the client's first hydration render uses the cookie language (e.g. 'de'). Every page's `t()` output then mismatches the server HTML, producing React hydration errors and an English→German content flash for USER/ADMIN accounts that chose a language. `suppressHydrationWarning` on `<html lang="en">` does not cover text-node mismatches. The bootstrap script only sets `documentElement.lang`; it cannot re-render content.
  - Required fix: Make the initial language deterministic across server and client (e.g. read the cookie in the bootstrap and drive initial state from a DOM attribute, or gate the cookie-based initialization behind a mounted effect instead of the initializer).

### Minor findings

- [Minor] `apps/web/scripts/check-hardcoded-german.mjs` — Guard has significant false-negative coverage gaps.
  - Evidence: It only matches German words/umlauts inside `apps/web/src`. Since English is the source language, newly introduced hardcoded English UI strings (the most likely regression) pass silently, and German texts in the API that surface in the UI (see Medium finding 1) are invisible to it. The word list also contains generic terms (`und`, `nicht`, `wird`, `sind`, `oder`, `mit`, `für`) that can produce false positives on non-UI strings.
  - Required fix: Extend the guard (or add a second check) for hardcoded user-visible strings in both languages and consider scanning the API error paths that render in the UI; document the guard's exact coverage.

- [Minor] `apps/web/src/app/settings/page.tsx:184-204` — Duplicate, divergent language controls for USER/ADMIN.
  - Evidence: The profile form keeps its own `locale` Select persisted via `PATCH /user/profile`, separate from the new `LanguageSelector` (`/user/language`). Saving via the profile form does not update the `I18nProvider` state or the `versigo:locale` cookie, so the change only takes effect after reload/server resolution and the two controls can show different values. This duplicates the persistence path introduced by AP-21.
  - Required fix: Remove the profile-form locale field (or route it through the same `LanguageService`/context so both controls stay in sync and update immediately).

- [Minor] `apps/web/src/i18n/i18n-context.tsx:83-89,113-141` — READ_ONLY language-change UX and stale-cookie flash.
  - Evidence: On reload, READ_ONLY has no cookie, so the UI briefly renders English before the server session resolution restores the chosen language. If a prior USER/ADMIN session left a `versigo:locale=de` cookie on the same browser, a READ_ONLY user briefly sees German before hydration corrects and deletes the cookie. Functionally correct (session-only enforced server-side), but not flash-free.
  - Required fix: Accept as documented UX limitation or extend the bootstrap to read the server-resolved language before first paint.

- [Minor] Test coverage gaps against AP-21 acceptance criteria.
  - Evidence: The API unit tests and smoke test 8o cover READ_ONLY session-only/non-persistence and USER/ADMIN persistence well. However, 8o does not perform a same-session GET after PUT (reload-within-session is only proven by the unit-level `resolveLanguage` test), and I could not verify an automated test asserting READ_ONLY receives 403 on `/user/profile` / `/user/preferences` (the acceptance criterion "READ_ONLY erhält keinen erweiterten Zugriff").
  - Required fix: Add an explicit same-session GET-after-PUT check in smoke 8o, and confirm/add a role-guard test proving READ_ONLY is denied on profile/preference endpoints.

### Areas verified as correct
- `@Roles(GlobalRole.READ_ONLY)` on `LanguageController` correctly allows all roles (RolesGuard uses minimum-rank semantics; READ_ONLY rank 1 = lowest). Verified.
- READ_ONLY language is stored only in `session.language` (no DB write, no audit call) — verified in `language.service.ts` and smoke test DB assertions.
- USER/ADMIN persistence in `users.locale`, migration default 'en' with legacy normalization, invalid-value 400 rejection — verified.
- en/de catalog key parity (identical key trees, no empty values, `satisfies Messages` type check + runtime parity test) — verified.
- Language resolution priority (stored/session → Accept-Language with q-values → en) — verified in constants + service + tests.
- No new third-party i18n dependency; custom type-safe `t()` — verified in `package.json`.
- Server-side READ_ONLY isolation (profile controller `@Roles(GlobalRole.USER)`, theme-context 403 handling) — verified.

## Verification
- Tests/checks inspected: `language.service/controller/constants` specs, `i18n.spec.ts` (parity/empty/must-differ), `docker-compose.test.yml` i18n guard wiring, `compose-smoke-test.sh` steps 8n/8o/9b, profile DTO/spec context.
- Important areas inspected: auth guards, session config (`main.ts`), settings page READ_ONLY gating, all major refactored pages, guard script, migrations, docs were not yet fully read.
- Remaining risks / not yet verified (budget exhausted): `profile.controller.spec.ts` READ_ONLY-403 coverage; `admin/integrations`, `admin/feature-flags`, `admin/page.tsx`, `coverage-summary-section.tsx`, UI primitives (`loading`, `page-header`, `card`, `button`, `form-field`, `alert`); `user-preferences` spec changes; the four updated docs and ADR-009 quality; the settings-page `useEffect([t])` dependency causing a profile refetch on every language change (minor, observed but not fully assessed).

## Recommendation for next steps
Re-run the review to (1) verify the READ_ONLY-403 test coverage, (2) inspect the remaining admin/coverage-summary components for hardcoded texts and date/currency handling, and (3) assess the hydration finding against the actual Next.js 16 behavior in this app before merging. All four Medium findings should be addressed before merge; they are acceptance-criteria violations of AP-21 (localized API errors, locale-aware date/number/currency formatting, SSR/CSR hydration).
