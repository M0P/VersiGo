# AP-13 Review — Round 5

## Review result (verbatim from code-reviewer)

### Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 1
- Verdict: PASS

### Findings

- [Minor] `apps/web/src/styles/globals.css:1145-1146` — duplicated `border-bottom` declaration in the mobile `.table td` rule
  - Evidence: Within the `@media (max-width: 639px)` block, `.table td` declares `border-bottom: none;` immediately followed by `border-bottom: var(--versigo-border-width) solid var(--versigo-border);`. The first declaration is dead code — the second always wins, so the reset has no effect (the intended behaviour of the latter declaration is preserved). Harmless at runtime, but it is a leftover/confusing duplicate in the new design-system stylesheet.
  - Required fix: Remove the `border-bottom: none;` line (1145) so the rule contains a single `border-bottom` declaration.

### Verification

**Round 4 fix — verified correct and complete**
- `apps/web/src/app/policies/[id]/costs/page.tsx` `<thead>` `<th>` texts (lines 152–157: "Gueltig von", "Gueltig bis", "Brutto", "Netto", "Frequenz", "Notiz") exactly match the `<tbody>` `<td data-label>` values (lines 163–168). All six cells carry `data-label`.
- The CSS mobile override in `apps/web/src/styles/globals.css:1127-1160` hides `thead` (`display: none`) and renders row labels exclusively via `.table td::before { content: attr(data-label); }` (line 1153–1154). The labels therefore render correctly on screens < 640px. The `<th>` count (6) matches the `<td>` count (6) per row.
- Cross-checked all other `.table` instances in the app — all carry matching `data-label` attributes: `household/costs/page.tsx:111-112`, `admin/page.tsx:98-100`, `admin/settings/page.tsx:186-211`, `admin/feature-flags/page.tsx:169-175`. No remaining unlabeled table cells.

**Final pass over the AP-13 change set**
- **Design tokens/system**: `globals.css` — five `@layer`s, semantic tokens, light/dark themes, breakpoints (640/1024), focus-visible, `prefers-reduced-motion`, mobile/tablet/desktop media overrides. Topbar z-index (drawer+1) and sidebar padding correct.
- **UI primitives**: app-shell (sidebar + topbar + mobile drawer with Escape/scroll-lock/matchMedia cleanup), page-header, card, button, form-field (label association, `aria-invalid`/`aria-describedby`), alert, empty-state, loading, dialog (focus trap, escape, focus restore), icons, nav-config. Semantics and a11y are sound.
- **Colour preference**: user-scoped API (`/user/preferences`, `@CurrentUser`, global `SessionAuthGuard`), hex validation server- and client-side (3/6-digit), 8 presets + custom hex, per-user `UserPreference` model (unique `[userId, key]`, cascade delete), no cross-user/household leakage. Prisma migration `20260730130000_ap13_user_preferences` present and consistent with naming convention.
- **Tests**: `colour-utils.spec.ts` (validateHex/hexToHSL/hslToHex normalization, round-trips, clamp), `user-preferences.service.spec.ts` (get/set/upsert, hex validation rejection incl. `<script>` and path traversal). Both appropriate for the changed layers.
- **Docs/contracts**: `docs/11-ui-ux.md` (tokens, breakpoints, components, a11y rules, colour customization, tested viewports, deferred work), `docs/04-data-model.md` (UserPreference), `README.md` (Compose commands + "Akzentfarbe wählen" section), `.env.example` (no new variables needed — only existing `NEXT_PUBLIC_API_BASE_URL` used), docker-compose stack unchanged (no new services/ports). Compose test suite config runs prisma migrate deploy, lint, typecheck, tests.
- **Regressions**: adjacent pages (login, policies list/detail/new, dashboard, admin pages, household costs, coverage summary) reviewed — no regressions found.

**Tooling limitation**
I had no Bash tool in this environment, so I could not literally execute `git diff` / `git status`. I compensated by confirming the branch via `.git/HEAD` (`feature/AP-13-design-system-responsive-ui`) and directly inspecting the complete current state of every AP-13 file (all UI components, all migrated pages, styles, theme context, colour utils, preferences API + tests, migration, docs, README, `.env.example`, compose files). The stated Compose verification (prisma migrate deploy, lint, typecheck, API 30 files/340 tests, web tests, build → "All checks passed!") was taken as given per instructions and not re-run.

**Remaining risks**
- None material. The single Minor (duplicate CSS declaration) is cosmetic and non-blocking; it does not affect rendering because the last declaration wins.
