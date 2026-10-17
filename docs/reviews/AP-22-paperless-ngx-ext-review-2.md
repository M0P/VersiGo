# AP-22-paperless-ngx-ext Review 2

## Verdict
CHANGES REQUIRED (reviewer reached max steps before producing the final formatted report; findings below are the reviewer's own findings)

## Verification of the four Round-1 fixes
- **High (backfill/APPLIED):** `scheduleManualLinkBackfill` now uses `OR: [{ taggingStatus: null }, { taggingStatus: { not: 'APPLIED' } }]` (confirmed at processor line 342), and `setTag` resets `APPLIED`→`PENDING` when `existing.paperlessTagId !== tagId` (service lines 246–251). Both fixes present.
- **Medium (getConfig null):** Still returns `null`, but the frontend now uses `res.json().catch(() => null)` + `setConfig(data ?? null)` (section line 74–75). False error removed. `documents-tab.tsx` `loadAssignedTag` was already try/catch-wrapped.
- **Medium (dual-origin delete):** Confirmed in `remove()` lines 571–593 — clears only `linkOriginManual` when both origins present, audits `UNLINK_MANUAL`, archives only when no tag origin remains.
- **Medium (NOT_FOUND vs TAG_DELETED):** `errorLabel` in `paperless-tag-section.tsx` now maps both `NOT_FOUND` and `TAG_DELETED` (lines ~150–152).

## Additional findings

1. **[High] `apps/api/src/features/paperless-ngx/paperless-tag.service.ts:300–342`** — `removeTag` clears `linkOriginTag` but never archives rows that have **no remaining origin** (`linkOriginManual=false`), so purely tag-assigned documents stay visible forever after "Tag entfernen" — contradicts the union-of-origins rule and the mirror logic in `reconcileAssignments`.
2. **[Medium] `removeTag` never resets `PolicyDocument.taggingStatus`** — combined with the backfill filter excluding `APPLIED`, a manual link that was `APPLIED` for a previous tag is never re-tagged after remove-then-reassign; stale `PENDING`/`FAILED` badges and a retry button that 404s (`NO_PAPERLESS_TAG_CONFIGURED`) persist.
3. **[Medium] Missing regression tests for the Round-2 fixes:** no `setTag` assertion on the `taggingStatus` reset, no processor assertion on the backfill `OR` (null) clause, no test for `getConfig`/unconfigured case, no dual-origin `remove()` test, and no tests for the new adapter methods (`searchTags`, `getTag`, `createTag`, `listDocumentsByTag`, `assignTagToDocument`).
4. **[Minor] Dead i18n key** `paperlessTagRetried` (both locales) and unused `manualOnly` response field; `paperless-tag.controller.ts` has no spec.

## Remaining tasks not completed
- Formal severity classification pass (Critical/High/Medium/Minor counts) was not finalized.
- A BullMQ compatibility check of `repeat` + custom `jobId` was verified against bullmq 5.34.0 source (not a defect — custom jobId is supported for repeatable jobs), so it should **not** be reported.
- The final formatted report (Summary / Findings / Verification / Verdict) was not produced.

## Recommendation
Re-read only `apps/api/src/features/paperless-ngx/paperless-tag.service.ts:300–342` plus the worker `reconcileAssignments` to confirm finding 1, then emit the report. Given finding 1 (likely High) and finding 2 (likely Medium), the verdict is almost certainly **CHANGES REQUIRED** under the stated acceptance bar (0 Critical, 0 High, 0 Medium).
