# BugFix-20 – Review Round 1

**Package:** BugFix-20 – UI to archive (delete) an insurance policy
**Branch:** `fix/policy-delete-ui`
**Commit under review:** `1200bdc`
**Date:** 2026-10-17

> **Important:** This report is a **self-review by the implementing agent**, not
> an independent review. The repository process requires the `code-reviewer`
> subagent for every round; all three reviewer subagents were **unavailable**
> in this session, so no independent review could be obtained (see
> "Blocker" below). The findings and the verification results below are the
> author's own and must be treated accordingly.

## Blocker: independent review not possible

| Attempt | Agent | Result |
|---------|-------|--------|
| 1 | `code-reviewer` | `Model unavailable: opencode/deepseek-v4-flash-free` |
| 2 | `code-reviewer_openrouter` | `Model unavailable: poolside/laguna-s-2.1:free` |
| 3 | `code-reviewer_modal` | `Provider request failed with HTTP 404: modal-http: invalid function call` |

Consequence: the acceptance bar "0 Critical / 0 High / 0 Medium / ≤ 8 Minor
confirmed by an independent reviewer" is **not** claimed. The user must decide
whether an independent review round is required before this package is
considered final.

## Scope reviewed

Uncommitted diff of `fix/policy-delete-ui` → `1200bdc`:

- `apps/api/src/features/policy-registry/policy-registry.service.ts` — `remove()`
  now writes `{ archivedAt, status: 'ARCHIVED' }` and logs `status` in the
  audit `diffJson`.
- `apps/api/src/features/policy-registry/__tests__/policy-registry.service.spec.ts`
  — pins the update payload.
- `apps/web/src/app/policies/[id]/page.tsx` — danger button + `window.confirm`
  + `DELETE` + redirect `?archived=1` + inline error alert.
- `apps/web/src/app/policies/page.tsx` — dismissible success notice on
  `?archived=1`.
- `apps/web/src/i18n/locales/de.ts`, `en.ts` — new keys.
- `docs/ui-control-matrix.md` — row 52 updated.

## Checklist

| Area | Result |
|------|--------|
| API behaviour / soft delete semantics | OK — hidden from `findAll`/`findPinned` via `archivedAt: null`; re-delete is idempotent; `hardDelete` stays ADMIN-only and is not exposed in the UI |
| Authorization | OK — controller `@Roles(GlobalRole.USER, GlobalRole.ADMIN)` on `DELETE :policyId`; `HouseholdMembershipGuard` on the controller; READ_ONLY receives 403 |
| TDD | OK — red phase observed (`policy-registry.service.spec.ts` failed on the missing `status: 'ARCHIVED'` before the service change), then green (23/23) |
| React lifecycle | Acceptable — no `setState` on the success path (component unmounts via `router.push`); no seq guard, unlike other tabs (see Minor 1) |
| i18n parity | OK — keys present in both catalogs; `i18n.spec.ts` and the runtime parity test pass |
| Accessibility | Acceptable — native `<button>` with visible text, native `window.confirm` (keyboard/screen-reader friendly), success notice uses `role="alert"` (via `Alert`) |
| No new runtime surface | OK — no new dependency, env var, queue, port or health endpoint; Compose stack, `.env.example` and smoke test unchanged (Future-Feature Contract) |
| Docs | OK — `docs/ui-control-matrix.md` matches the implementation |

## Findings

### Minor 1 — no request-sequence guard in `handleDelete`

`apps/web/src/app/policies/[id]/page.tsx` (`handleDelete`). Other policy tabs
use a `requestSeq` token to discard stale responses after a `policyId` change.
`handleDelete` does not, so a failed delete of policy A could set an error
message after the user navigated to policy B (the component for B is the same
mounted component). Impact is a transient, wrong-context error alert. Not fixed
because the delete path ends in either a redirect (success) or a single error
alert, and adding a counter would be a behaviour-neutral change better done
together with a dedicated fix.

### Minor 2 — delete button visible to READ_ONLY

`apps/web/src/app/policies/[id]/page.tsx`. READ_ONLY users can open the detail
page; the button renders and the API answers 403, showing the generic
"Fehler beim Löschen der Versicherung.". The sibling tabs
(`covered-persons-tab`, `documents-tab`, `portal-links-tab`) behave the same
way, so this is consistent with the current codebase and the server enforces
authorization. Hiding the control for READ_ONLY would require loading the
current user into the page and is left as a follow-up.

### Minor 3 — success notice reappears on manual reload

`apps/web/src/app/policies/page.tsx`. `?archived=1` stays in the URL, so a
manual reload shows the notice again. Harmless and dismissible; the URL is not
rewritten because the repository has no `history.replaceState` pattern and
Next.js App Router router state should not be mutated directly without care.

### Minor 4 — inline notice instead of a toast

`docs/ui-control-matrix.md` originally specified a toast ("Archiviert"). The web
app has no toast infrastructure (no toast component exists), so the package
uses a dismissible inline `Alert` (list page) and an inline `Alert` (detail
page error). The matrix row was updated to describe the actual behaviour
instead of inventing toast infrastructure.

## Verification performed (see handoff for the full list)

`docker compose -p versigo-test -f docker-compose.test.yml up --build
--abort-on-container-exit --exit-code-from test` → prisma migrate deploy → lint
→ typecheck → tests → licence check → version-sync → i18n guard →
**"All checks passed!"** (api 750 tests / 62 files, web 58 / 5, foundation
107 / 12, worker 30 / 3).

**Not covered:** no browser/e2e or accessibility harness exists in this
repository, so the new button, the confirm dialog, the redirect and the success
notice were **not** verified in a browser. Target end-to-end verification (dev
stack, manual click-through) is a follow-up.
