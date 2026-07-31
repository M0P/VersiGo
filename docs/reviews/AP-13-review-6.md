# AP-13 Review — Round 6

## Review result (verbatim from code-reviewer)

### Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

### Findings

- [Minor] `apps/web/src/app/admin/page.tsx:82` — Dead conditional in `className` attribute
  - Evidence: `className={validation?.valid ? undefined : undefined}` — both ternary branches are identical (`undefined`), so the expression always evaluates to `undefined` and is meaningless dead code left in a page migrated as part of AP-13. It has no runtime effect but is confusing.
  - Required fix: Remove the `className` attribute (or use a meaningful conditional class if styling was intended).

- [Minor] `apps/web/src/components/ui/dialog.tsx:85,97` — Hard-coded `id="dialog-title"` in a reusable primitive
  - Evidence: The dialog panel hard-codes `aria-labelledby="dialog-title"` (line 85) pointing at `<h2 id="dialog-title">` (line 97). If two `Dialog` instances ever render on the same page, the second dialog's `aria-labelledby` will resolve to the first dialog's heading (duplicate HTML IDs), breaking the accessible-name association. The component is currently unused, so this is latent, not a live defect.
  - Required fix: Derive a unique id (e.g. via `useId()` or an `id` prop) for the title and reference it in `aria-labelledby`.

### Verification

**1. Round 5 Minor fix (mobile `.table td` duplicate `border-bottom`) — VERIFIED CORRECT:**
- `apps/web/src/styles/globals.css:1140-1146` — the `.table td` rule inside `@media (max-width: 639px)` now contains exactly **one** `border-bottom` declaration (line 1145: `border-bottom: var(--insura-border-width) solid var(--insura-border);`).
- The dead `border-bottom: none;` line is gone; no other declarations in the rule were disturbed (`display: flex`, `justify-content: space-between`, `align-items: center`, `padding: var(--insura-space-2) 0` all intact).
- The rule set is otherwise intact: `.table thead` (1127), `.table tr` (1131), `.table td:last-child { border-bottom: none }` (1148-1150, intentional reset for the last row), and `.table td::before` (1152) all present and unchanged. Total `border-bottom` occurrences in the file are consistent (lines 436, 463, 698, 704, 710, 903, 1145, 1149 — each in its correct rule).

**2. Round 4 Medium fix (missing `data-label`) — still VERIFIED:**
All tables using the mobile stacked pattern carry `data-label` on every `td`: `policies/[id]/costs/page.tsx:163-168` (all 6 cells), `household/costs/page.tsx:111-112`, `admin/page.tsx:98-100`, `admin/settings/page.tsx:186-211`, `admin/feature-flags/page.tsx:169-175`.

**3. Final pass — no Critical/High/Medium findings:**
- Design tokens, light/dark themes, breakpoints, focus-visible, `prefers-reduced-motion`, responsive media blocks (`globals.css`) — coherent, layered, token-driven.
- Colour pipeline: `colour-utils.ts` (validateHex/hexToHSL/hslToHex, normalization + clamping) → `theme-context.tsx` (FOUC bootstrap gating via `ready`, localStorage only as render cache, server as source of truth) → `appearance-settings.tsx` (presets + validated hex input, accessible swatches with aria-label/aria-pressed).
- Backend: `user_preferences` migration (unique `userId_key`, FK cascade), controller guarded by global `SessionAuthGuard`, service validates `ui:accentColour` strictly (3/6-digit hex, rejects script/path injection), scoping to session user via `userId` composite key — no cross-user leakage.
- Responsive shell: `app-shell.tsx` drawer (Escape close, scroll-lock restore, 640px media-query close, correct z-index layering topbar 301 > drawer 300), focus-trap dialog, accessible form fields (htmlFor/aria-describedby/aria-invalid), `role="alert"` alerts.
- Docs/contracts: `docs/11-ui-ux.md` (tokens/breakpoints/a11y/colour behavior), `docs/04-data-model.md`, `README.md` ("Akzentfarbe wählen" + Compose commands); `.env.example` needs no new variables (only existing `NEXT_PUBLIC_API_BASE_URL`); Compose stack unchanged — Compose contract satisfied.
- Tests: `colour-utils.spec.ts` (18 web tests) covers validation, HSL conversion, round-trips, normalization, clamping; `user-preferences.service.spec.ts` covers validation rejection and per-user scoping. Full Compose suite (migration deploy, lint, typecheck, foundation/API/worker/web tests, build) reported green — not re-run per instructions.

**Remaining risks:**
- The two Minor findings above; both non-blocking and latent (Dialog is unused; dead className is inert).
- No other issues observed. PASS (0 Critical, 0 High, 0 Medium, 2 Minor ≤ 8).
