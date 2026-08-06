# BugFix-08 Review Round 1

Date: 2026-08-06

Work package: `prompts/BugFix-08-costs-overhaul-and-overview-page.md`

Reviewed by: code-reviewer subagent (`ses_0288e452dffeWtFTSZxh7Wu3jN`)

Verdict: CHANGES REQUIRED

---

## Review result (verbatim)

## Summary
- Critical: 1
- High: 0
- Medium: 1
- Minor: 3
- Verdict: CHANGES REQUIRED

## Findings

- [Critical] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:379` — `create()` auto-ends the just-created entry instead of its predecessor
  - Evidence: Inside the transaction, the entry is created first (line 363) and then `endPredecessor(tx, policyId, validFrom)` is called **without** `excludeEntryId`. `endPredecessor` (lines 311–318) runs `findMany` over all entries *including the new one*, and `entryForPeriod` selects the entry with the greatest `validFrom <= periodStart`. Since the new entry's `validFrom` equals the target `validFrom` (and the collision check at line 361 prevents any other entry from having it), the new entry is always selected as its own "predecessor". Lines 321–327 then set the *new* entry's `validTo = validFrom − 1ms`, i.e. an end before its own start. Consequences: every created cost entry is immediately invalid (`entryForPeriod` filters it out for all periods, so it never contributes to paidToDate/schedule), the increase-from-date feature never takes effect, and the dead entry can no longer be repaired via PATCH (the `validTo <= validFrom` guard at line 451 rejects it). This breaks the central deliverable of the work package. The service spec test at `cost-tracking.service.spec.ts:88-127` masks the bug because `mockDb.policyCostEntry.findMany` is stubbed to return only the old entry `c1`, never the newly created one — a real Prisma interactive transaction would return both.
  - Required fix: Pass the created entry id to `endPredecessor` in `create`, i.e. `endPredecessor(tx, policyId, validFrom, entry.id)`, or compute/end the predecessor before inserting the new row. Additionally, make the create test stub `findMany` to include the just-created entry so this regression is caught.

- [Medium] `apps/web/src/app/policies/[id]/costs-overview-card.tsx:127` — stale schedule from the previous policy is displayed after a policyId change
  - Evidence: In `reload()`, after the seq guard, `if (scheduleData) setSchedule(scheduleData)` only updates state when the fetch succeeds. If the schedule request for the new policy fails (non-OK or network error), `scheduleData` is `null`, the state still holds the previous policy's schedule, and `!schedule` is false, so the old policy's paid-to-date/period table renders under the new policy without the `costs.unavailable` warning. This is exactly the cross-policy stale-data class of bug that BugFix-05 (Befund 8) addressed elsewhere (cf. `covered-persons-tab.tsx` which resets state on every reload). Entries are cleared (`setEntries(entriesData ?? [])`) but the schedule is not.
  - Required fix: Set `setSchedule(scheduleData)` unconditionally after the seq guard (so a failed fetch clears it to `null` and shows the warning), and/or reset `schedule` to `null` at the top of `reload()` / in the `useEffect` on `policyId`.

- [Minor] `apps/web/src/app/policies/[id]/costs-overview-card.tsx:392-396` — edit-frequency dropdown offers SEMI_ANNUAL for entries that cannot legally use it
  - Evidence: `ALL_FREQUENCIES` (line 18) includes `SEMI_ANNUAL` for every edited entry, but the API DTO rejects SEMI_ANNUAL for all writes (`@IsIn(COST_FREQUENCIES)` in `cost-tracking.dto.ts:70`). A user who changes a MONTHLY/QUARTERLY/ANNUAL entry to SEMI_ANNUAL gets an opaque `costs.updateErrorDetail` with no explanation.
  - Required fix: Only include the SEMI_ANNUAL option when `editingOriginalFrequency === 'SEMI_ANNUAL'` (so legacy entries remain editable without frequency change, as intended).

- [Minor] `apps/web/src/app/policies/[id]/costs-overview-card.tsx:203-208` — edit form cannot clear `validTo`/`netAmount` and truncates timestamps
  - Evidence: `if (editForm.validTo) body.validTo = ...` and `if (editForm.netAmount !== '') ...` omit empty values, so a user cannot make a closed entry open-ended or remove a net amount via the UI. Additionally, `toEditForm` (lines 70–79) slices timestamps to `YYYY-MM-DD`; for any legacy entry whose `validFrom` carried a time-of-day component, saving without changes silently shifts `validFrom` to midnight, which can alter period alignment or trigger the collision check.
  - Required fix: Send `validTo: null` when the field is cleared (and `netAmount: null`/omit appropriately), and round-trip the full ISO value or explicitly document date-only semantics.

- [Minor] `apps/api/src/features/cost-tracking/__tests__/cost-tracking.service.spec.ts` — READ_ONLY-without-share rejection is untested for the per-policy read endpoints
  - Evidence: The isolation suite covers cross-household denial for `findAll`/`findOne`/`getSchedule`/`getHouseholdSummary` and the summary's `getReadablePolicyIds` filtering (lines 694–737), but no test asserts that a READ_ONLY member *of the same household* without a share is rejected on `findAll`/`findOne`/`getSchedule` (the `assertPolicyReadAccess` READ_ONLY branch at `auth.service.ts:407-412`). The write path's `@Roles(USER, ADMIN)` guard in the controller is likewise never asserted.
  - Required fix: Add READ_ONLY-without-share rejection specs for the per-policy read methods and a controller-level role-guard assertion for the write endpoints.

## Verification

- **Tests/checks reviewed**: `cost-tracking.service.spec.ts` (765 lines) genuinely covers the four mandated cases — paid-to-date-as-sum-of-periods (line 355), increase-from-date/auto-end (line 88), frequency change (line 417), and increase-mid-year (lines 455, 621) — plus leap-year re-anchoring (line 521), legacy scaling (line 491), empty entries, missing policy, and READ_ONLY summary filtering. Controller and isolation specs cover delegation and cross-household denial. The create test's mock does not reflect real transaction visibility (masks the Critical bug).
- **Areas inspected**: full service/controller/DTO rewrite, Prisma schema (no schema change — `PolicyCostEntry`/`PaymentFrequency` untouched, so no new migration is warranted), route ordering (`schedule` before `:entryId`), module wiring, both new UI components, policy detail tab integration, i18n `costs.*` key trees (en vs. de are identical; every key used in TSX exists in both locales, no hardcoded German found in JSX), no remaining references to `overview/annual/compare/paid-history` endpoints or the deleted `policies/[id]/costs/page.tsx` (only doc comments), German API messages, and READ_ONLY enforcement via `assertPolicyReadAccess`/`getReadablePolicyIds` plus controller `@Roles`.
- **Remaining risks**: The Critical bug is the dominant blocker. Secondary risks are the stale-schedule display on policy switch and the inability to clear `validTo`/`netAmount`. No security leak was found on the server side (every read/write path is household- or share-gated).

Overall verdict: The work package is structurally sound — period arithmetic with anchor re-anchoring, cents-based summation, lossless SEMI_ANNUAL handling, German API messages, full i18n parity, and dead-endpoint removal are all correctly implemented and well tested. However, the `create()` self-ending bug makes the central "increase costs from a date" feature non-functional in real usage and is only hidden by an unrealistic test mock, so the package must not be merged until that is fixed and the medium/minor items are addressed.
