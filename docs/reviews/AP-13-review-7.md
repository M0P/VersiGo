# AP-13 Review — Round 7

## Review result (verbatim from code-reviewer)

### Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

### Findings

- No findings.

**Verification of the two Round 6 fixes:**

1. **`apps/web/src/app/admin/page.tsx:82` — dead `className` removed**
   - The `<strong>` element now reads `<strong style={{ color: validation?.valid ? 'var(--versigo-success)' : 'var(--versigo-danger)' }}>` — no `className` attribute. The `style` attribute is intact, and the conditional rendering `{validation?.valid ? 'Gültig' : 'Fehlerhaft'}` on line 83 is untouched. A repo-wide grep for `className={validation?` returns zero matches.

2. **`apps/web/src/components/ui/dialog.tsx` — `useId`-based title id**
   - `useId` is imported from `'react'` (line 3) alongside `useEffect`, `useRef`, and the type imports.
   - `const titleId = useId();` is declared once at line 24 and used in both required places: `aria-labelledby={titleId}` on the overlay (line 86) and `<h2 id={titleId}>{title}</h2>` (line 98).
   - No `dialog-title` references remain anywhere in the repository (grep across all files: zero matches), including CSS (the `.dialog-*` styles at `globals.css:735-770` use only class selectors).
   - The `useId` approach is correct for a reusable primitive: it is hydration-safe (deterministic per component-tree position), unique per component instance (no collisions if multiple dialogs render), and there is no CSS selector that would need colon-escaping for the generated `:r…:` ids.

**Earlier-round fixes confirmed still intact:**
- Round 5 (`globals.css:1145`): the duplicate `border-bottom: none;` is gone; the mobile `.table td` rule now has a single `border-bottom` declaration.
- Round 4 (`apps/web/src/app/policies/[id]/costs/page.tsx:163-168`): all six `<td>` cells carry matching `data-label` attributes; every other migrated table (`household/costs`, `admin`, `admin/settings`, `admin/feature-flags`) also carries `data-label` on all cells.

## Verification
- **Fixes verified:** `dialog.tsx` (useId import, titleId in both `aria-labelledby` and `<h2 id>`), `admin/page.tsx` (className gone, style + conditional rendering intact).
- **Areas inspected:** UI primitives (`form-field.tsx`, `appearance-settings.tsx`, `dialog.tsx`), theme context (`theme-context.tsx` — user-scoped persistence, localStorage only as a rendering cache, no cross-user leakage), colour utils (`colour-utils.ts` — hex validation/normalization, HSL round-trip), mobile table CSS (`globals.css:1127-1160`), all `data-label` table usages, `.git/HEAD` confirms branch `feature/AP-13-design-system-responsive-ui`.
- **Hard-coded ids found** (`custom-colour`, `custom-colour-error` in `appearance-settings.tsx:100,113`) are page-level single-instance ids, not reusable-primitive ids — not a finding.
- The `Dialog` primitive is currently unused by any page (consistent with AP-13 §1 "where an existing view needs one"), type-checks, and is part of the design-system deliverable — not a finding.
- **Tests/checks:** Per instructions, the Compose suite (prisma migrate deploy, lint, typecheck, foundation 6 files/21 tests, API 30 files/340 tests, worker 1 file/4 tests, web 1 file/18 tests, build → "All checks passed!") was taken as given and not re-run.
- **Remaining risks:** None material. All previously identified findings (1 Medium across Rounds 1-4, 1 Minor in Round 5, 2 Minors in Round 6) are resolved; the change set is stable across three consecutive passing reviews.

## Severity counts
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Minor | 0 |

**Verdict: PASS** (0 Critical, 0 High, 0 Medium, 0 Minors — well within the ≤8 Minor limit).
