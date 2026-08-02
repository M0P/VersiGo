# AP-21 Review – Iteration 2

> Unabhängiges, read-only Review durch den `code-reviewer`-Subagenten
> (Session `ses_03e29ad70ffeIAaj83zK8UE11x`). Wortgetreue Kopie des
> Review-Ergebnisses.

## Review result
- Critical: 0
- High: 0
- Medium: 1
- Minor: 8
- Verdict: CHANGES REQUIRED

## Findings

### Confirmed findings

- [Medium] `apps/web/src/i18n/auth-errors.ts:20-21,39-45` — Register error mapping is wrong for the "registration disabled" case: `409` is mapped to `usernameTaken`, `501` to `registrationDisabled`.
  - Evidence: The register endpoint never returns 501; when local registration is disabled the API throws `ConflictException` → HTTP 409 (`apps/api/src/features/identity/auth.controller.ts:80-82`). The register page renders the form unconditionally (no `/auth/config` gate), so a direct visit to `/register` with registration disabled submits and the UI shows "Dieser Benutzername ist bereits vergeben / This username is already taken" instead of a "registration disabled" message. The `auth.registrationDisabled` catalog key is therefore unreachable via the register flow.
  - Required fix: In `localizeAuthError`, either distinguish the disabled-registration 409 (e.g. map 409 → `usernameTaken` only when the conflict is a duplicate username, or have the API return a distinct code for disabled registration) so the UI never shows the wrong reason.

### Minor findings

- [Minor] `docs/adr/ADR-009-multi-language-support.md:76-78` — Stale statement "READ_ONLY nutzt ausschließlich den Cookie (Sitzungs-Persistenz)".
  - Evidence: The implemented design forbids the `versigo:locale` cookie for READ_ONLY; READ_ONLY language lives in the express-session and is resolved via `GET /user/language` (`language.service.ts:44-54`). The ADR contradicts the code and the documented cookie contract.
  - Required fix: Update the ADR to describe the session-only resolution (no cookie for READ_ONLY), matching the implementation.

- [Minor] `docs/adr/ADR-009-multi-language-support.md:86-88` — Stale statement "Die Profil-API (`PATCH /user/profile`) akzeptiert keine `locale`-Änderung mehr".
  - Evidence: `profile.dto.ts:24-26` still accepts `locale` (`@IsIn(SUPPORTED_PROFILE_LOCALES)`), and `profile.service.ts:44-46` still writes it, kept deliberately for API compatibility (comment in `profile.dto.ts:9-10`). The ADR should state locale remains accepted but is deprecated/UI-unused.
  - Required fix: Align the ADR consequence section with the actual API behavior.

- [Minor] `apps/web/src/app/layout.tsx:60-69` + `apps/web/src/i18n/i18n-context.tsx:101-117` — Accept-Language resolution is never applied for unauthenticated visitors.
  - Evidence: AP-21 requires priority "stored/session preference → Accept-Language → English". For guests, the initial language comes only from the cookie (default en) and `GET /user/language` returns 401 (`language-client.ts:22-27`), so a German-locale visitor always sees English on login/register even though the priority chain includes Accept-Language. READ_ONLY/USER/ADMIN get the header-based resolution; guests do not.
  - Required fix: Either document this as a deliberate limitation (login pages default to en) or resolve the guest language from `Accept-Language`/`navigator.language` (e.g. in the bootstrap script or a public server endpoint).

- [Minor] `apps/web/src/i18n/index.ts:16` — `readLanguageCookie` is exported but now unused.
  - Evidence: The hydration fix moved cookie reading server-side into `layout.tsx`; `readLanguageCookie` (i18n-context.tsx:47-57) has no callers left (verified via grep). Dead public API surface.
  - Required fix: Remove it or keep it with a note if intended for future use.

- [Minor] `apps/web/src/app/settings/page.tsx:154`, `apps/web/src/app/admin/settings/page.tsx:83` — Inline locale date/number formatting duplicates the new `format.ts` helpers.
  - Evidence: Both use `toLocaleDateString/toLocaleString(language === 'de' ? 'de-DE' : 'en-GB')` while `formatDate`/`formatNumber` now exist and are used on the other pages. Functionally locale-aware, but the locale mapping is duplicated in three places.
  - Required fix: Switch these call sites to the shared `formatDate`/`formatNumber` helpers.

- [Minor] `apps/web/src/__tests__/` — New `auth-errors.ts` and `format.ts` modules have no direct unit tests.
  - Evidence: The only web test is `i18n.spec.ts` (core/catalog parity); the status→message mapping and the `Intl` wrappers are untested. Given the Medium finding above, a test would have caught the 409/501 mismatch.
  - Required fix: Add unit tests for `localizeAuthError` (all statuses, both contexts) and for `formatCurrency/formatDate/formatNumber` locale behavior.

- [Minor] `apps/web/src/app/settings/page.tsx:58-65` — Profile refetch triggered on every language change.
  - Evidence: `loadProfile` effect depends on `t` (line 65); switching language re-creates `t`, causing a redundant `GET /user/profile`. Pre-existing from Round 1, retained in the refactor. Harmless but wasteful.
  - Required fix: Drop `t` from the dependency array (guard the fetch with a stable ref or ignore the lint) so language changes don't refetch the profile.

- [Minor] `apps/web/src/i18n/format.ts:31-33` — `formatDate` throws `RangeError` on invalid date input.
  - Evidence: `Intl.DateTimeFormat.format(new Date(''))` throws; the previous `toLocaleDateString()` had the same behavior, so this is not a regression, but the new shared helper is now the single funnel for all date rendering. Inputs come from the API (`validFrom`, `startDate`), which is normally valid.
  - Required fix: Optionally guard invalid dates (return `''` or the raw value) for robustness.

## Areas verified as correct
- **Hydration fix (Round-1 Medium #4):** `layout.tsx` (async, `cookies()`, `<html lang>`), `providers.tsx` prop forwarding, and `I18nProvider` deterministic `useState(normalizeLanguage(initialLanguage))` make SSR and first client render consistent; no hydration-mismatch source remains for cookie-bearing users.
- **Auth error localization (Round-1 Medium #1):** login/register no longer render raw `body.message`; status mapping implemented; all referenced catalog keys exist in en.ts/de.ts with parity.
- **Locale formatting (Round-1 Medium #2/#3):** `formatCurrency`/`formatDate` applied in `policies/page.tsx`, `household/costs/page.tsx`, `policies/[id]/page.tsx`, `policies/[id]/costs/page.tsx`; no remaining `toFixed(2) EUR` or locale-less `toLocaleDateString()` in those pages.
- **Settings refactor (Round-1 Minor #2):** locale Select removed; PATCH body sends only `displayName`; READ_ONLY branch renders `LanguageSelector showReadOnlyNote` only; no unused imports left.
- **README_ONLY isolation:** `LanguageController` `@Roles(READ_ONLY)` allows all roles via minimum-rank; `/user/profile` and `/user/preferences` remain `@Roles(USER)` (403 for READ_ONLY); READ_ONLY language never touches DB/audit; cookie is actively deleted (`writeLanguageCookie(null)`) on session persistence; new `user-preferences.controller.spec.ts` asserts USER metadata; smoke test 8o asserts 403 on both endpoints and DB non-persistence.
- **Smoke tests (8n/8o/9b):** shell logic correct — fresh READ_ONLY user, session GET-after-PUT check, logout/relogin resets to en, DB assertion, cleanup; 9b 401 for unauthenticated; curl sends no Accept-Language so defaults are deterministic.
- **API language feature:** Accept-Language parsing with q-value ordering and tests; DTO validation 400; migration sets default 'en', normalizes legacy values, removes obsolete `language` preference; session write only for READ_ONLY.
- **Guard script:** header documentation expanded to state coverage and known limitations (API not scanned, English hardcodes not detected).
- **Contract:** No new third-party dependency, no new env vars/services required; docker-compose.test.yml wires `test:i18n`; all canonical gates reported passing.

## Remaining risks / not yet verified (budget exhausted)
- Could not run `git diff` (no shell tool); reviewed files individually — a handful of changed files (e.g. `appearance-settings.tsx`, `admin/*` pages, `app-shell.tsx`, `nav-config.tsx`, full `en.ts/de.ts` beyond the inspected ranges, `docker-compose.yml`/`.env.example` diffs) were inspected only partially or not at all.
- The reported "all checks passed" verification (tsc/eslint/vitest/i18n guard/canonical compose gate/smoke) was taken as stated; I did not execute it.
- Unauthenticated-visitor Accept-Language behavior (Minor #3) is a judgment call on requirement interpretation; confirm with the product owner whether login/register pages must follow the browser language.
- `formatDate` invalid-input behavior across all call sites was reasoned about, not runtime-tested.

## Resolution notes (Round 2 fixes applied after this review)
- **Medium:** register endpoint now returns 501 NOT_IMPLEMENTED (not 409) for disabled registration (`auth.controller.ts`), test updated; `auth-errors.ts` documents the status contract.
- **Minor 1/2:** ADR-009 decision #4 and consequences rewritten to match implementation (no cookie for READ_ONLY; profile `locale` accepted but UI-unused).
- **Minor 3:** documented as deliberate limitation in ADR-009 (guests default to en).
- **Minor 4:** `readLanguageCookie` removed (function + barrel export).
- **Minor 5:** settings + admin/settings pages now use shared `formatDate`.
- **Minor 6:** new `apps/web/src/__tests__/i18n-helpers.spec.ts` (12 tests) covering `localizeAuthError` and the `Intl` wrappers.
- **Minor 7:** `t` removed from the settings effect deps (no more refetch on language change).
- **Minor 8:** `formatDate` guards invalid input (returns `''`/raw value).
