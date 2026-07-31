# AP-13 Review — Round 4

## Review result (verbatim from code-reviewer)

### Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 0
- Verdict: CHANGES REQUIRED

### Findings

- [Medium] `apps/web/src/app/policies/[id]/costs/page.tsx:161-169` — Cost-entries table cells are missing `data-label` attributes, so the mobile stacked-row table renders unlabeled values
  - Evidence: The delta migration adopted the design-system table pattern (`.table-container`/`.table`), and the mobile override in `apps/web/src/styles/globals.css:1127-1160` hides `thead` entirely (`display: none`) and renders row labels exclusively via `td::before { content: attr(data-label) }`. Every other migrated table in the app sets these attributes (`household/costs/page.tsx:111-112`, `admin/settings/page.tsx:186-211`, `admin/page.tsx:98-100`, `admin/feature-flags/page.tsx:169-175`), but the six `<td>` cells in the costs table do not. On screens < 640px the cost-entries table therefore shows columns of bare values (dates, EUR amounts, frequency) with no header or label context — precisely what AP-13 §3 requires to be avoided ("Tables and dense data must remain usable on small screens through responsive columns, stacked rows, or an equivalent accessible pattern"). This is a real usability gap for financial data on mobile, and the new page fails to follow the established convention.
  - Required fix: Add `data-label` to each cell in the `<tbody>` rows matching its `<th>` text (e.g. `data-label="Gueltig von"`, `"Gueltig bis"`, `"Brutto"`, `"Netto"`, `"Frequenz"`, `"Notiz"`), mirroring the other migrated tables.

### Verification

**Delta 1 — costs page migration (behavior preservation):**
- Fetch logic, 401 redirects, error handling, and option values verified against the API contract: `CreateCostEntryDto` (`cost-tracking.dto.ts:5-34`) accepts exactly `validFrom`, optional `validTo`, `grossAmount`, optional `netAmount`, `frequency`, optional `note` — matching the constructed POST body (lines 87-94). `PaymentFrequency` enum (`MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL`) matches the four `<option>` values (lines 217-220).
- Annual-summary type matches the service response shape (`cost-tracking.service.ts:261-273`); `annualGross`/`annualNet` are `Number()`-converted, so the direct `.toFixed()` calls are safe (no Prisma-Decimal string issue).
- Conventions match the reference pages (`policies/page.tsx`, `policies/new/page.tsx`): AppShell + NAV_SECTIONS, PageHeader with action, Card sections, FormField + Input/Select with proper label association, Loading state, Button submit. The `Link`-based "Zurueck zur Police" action is consistent with the existing `btn` classes.
- Accessibility on the page is otherwise sound: labelled controls, semantic `dl`/table markup, `role="status"` loading, disabled submit while submitting.

**Delta 2 — globals.css:**
- `.detail-list` (lines 717-733): correct `auto 1fr` grid; conditional `<>...</>` fragments flatten into the grid so dt/dd pairs auto-place correctly.
- Mobile topbar `z-index: calc(var(--insura-z-drawer) + 1)` = 301 over drawer 300 (lines 1106-1111): correct layering, toggle remains reachable/clickable above the open drawer; the mobile media block follows the tablet block in source order so the override wins. Sidebar `padding-top: var(--insura-space-16)` (64px) clears the 56px topbar.
- Migration-naming judgment: **confirmed, no rename needed.** `20260730130000_ap13_user_preferences` matches the `YYYYMMDDHHMMSS_apN_description` convention of every sibling migration. The only oddity is that `20260730120000_ap14_local_credentials` sorts before ap13; this is harmless because neither migration depends on the other (both only FK to `users`), and `prisma migrate deploy` passed.

**Delta 3 — app-shell matchMedia:**
- Listener add/remove symmetry correct for both `keydown` and `change` (lines 45-51); cleanup restores `previousOverflow` captured at effect start; no stale closures (`setSidebarOpen` is stable, deps `[sidebarOpen]` correct). The 640px breakpoint matches the CSS tablet breakpoint (`--insura-bp-tablet-min`). Drawer cannot be opened at ≥640px because the toggle is `display:none` there, so the "open while already desktop" edge case is unreachable.

**Security (user-preferences API):** All endpoints protected by the global `SessionAuthGuard` (APP_GUARD, `identity.module.ts:22`); reads/writes scoped to the session user via `userId` composite key; `ui:accentColour` values strictly validated (3/6-digit hex, `user-preferences.service.ts:27-36`); no cross-user/household leakage. Service tests cover validation rejection and scoping.

**Checks reviewed:** `colour-utils.spec.ts` (hex parse/normalize/round-trip), `user-preferences.service.spec.ts` (10 cases), DTOs, Prisma schema/model, migration SQL, auth guard wiring. Canonical Compose suite reported green (prisma migrate deploy, lint, typecheck, 340 API tests, web tests, build) — not re-run.

**Remaining risks:** The missing `data-label` (the Medium above) is the only delta defect found. No regressions observed in adjacent pages (dashboard, policy detail, household costs, admin pages, login).

**Recommendation:** Add the `data-label` attributes to the costs table cells and re-run the web build/lint; the work package is otherwise complete and consistent.
