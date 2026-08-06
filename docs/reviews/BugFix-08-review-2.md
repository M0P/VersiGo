# BugFix-08 Review Round 2

Date: 2026-08-06

Work package: `prompts/BugFix-08-costs-overhaul-and-overview-page.md`

Reviewed by: code-reviewer subagent (`ses_028859d53ffewixuR8dmK0qa2G`)

Verdict: CHANGES REQUIRED

---

## Review result (verbatim)

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 1
- Verdict: CHANGES REQUIRED

## Findings

### Round-1 fixes — verification (all confirmed correct)

1. **[Critical] `create()` self-ending bug — FIXED.** `cost-tracking.service.ts:382` now calls `endPredecessor(tx, policyId, validFrom, entry.id)`, excluding the just-created entry from the predecessor search. The spec test (`cost-tracking.service.spec.ts:88-138`) stubs `findMany` to return both `c1` and the new entry (real transaction visibility) and asserts the update targets `c1` with `validTo = 2024-12-31T23:59:59.999Z`. If the fix were reverted, `entryForPeriod` would select the new entry (validFrom 2025-01-01) and the update would target `entryId`, failing the assertion. The test genuinely catches the regression.
2. **Medium stale-schedule — FIXED.** `costs-overview-card.tsx:133` now calls `setSchedule(scheduleData)` unconditionally after the seq guard (clears to `null` on failure), and the `.catch` also sets `setSchedule(null)`. The `!schedule` warning renders correctly on failure.
3. **Minor SEMI_ANNUAL dropdown — FIXED.** `costs-overview-card.tsx:409` shows `ALL_FREQUENCIES` only when `editingOriginal?.frequency === 'SEMI_ANNUAL'`, else `NEW_FREQUENCIES`.
4. **Minor clear validTo/netAmount + timestamp truncation — FIXED.** `handleUpdate` (`costs-overview-card.tsx:212-225`) compares against `editingOriginal` and sends only changed fields, sending `null` for cleared `validTo`/`netAmount`/`note`. The comparison expressions match `toEditForm()` exactly, so unchanged timestamps round-trip. The `UpdateCostEntryDto` (`@IsOptional`) and service (`dto.validTo !== undefined ? ... : existing.validTo`) both accept `null`.
5. **Minor READ_ONLY/role-guard tests — FIXED.** Service spec adds READ_ONLY-without-share rejection for `findAll`/`findOne`/`getSchedule` (lines 776-807); controller spec asserts `@Roles` metadata via `ROLES_KEY` for write (USER+ADMIN) and read + summary (incl. READ_ONLY) endpoints (lines 124-140). `SetMetadata` on methods is correctly read via `Reflect.getMetadata(ROLES_KEY, prototype.method)`.

### New / remaining findings

- [Medium] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:477-478` — moving an increase entry's `validFrom` later leaves a coverage gap (predecessor is not restored)
  - Evidence: `update()` only calls `endPredecessor`, which *ends* a predecessor but never *re-opens* one. Scenario: `c1` (2024-01-01, open) is auto-ended at `2024-12-31T23:59:59.999` when `c2` (2025-01-01) is created. The user then PATCHes `c2.validFrom` to `2026-01-01`. `endPredecessor(tx, policyId, 2026-01-01, c2)` runs `entryForPeriod` at 2026-01-01, where `c1` is filtered out (`validTo 2024-12-31 < 2026-01-01`), so no predecessor is found and `c1` stays ended. Result: the whole of 2025 has **no** applying entry, so `paidToDate`/`periods` report 0 for that year — violating the package's core rule "at any point in time exactly one entry applies" and silently under-reporting spend. This is reachable via the supported "edit historic entries" flow.
  - Required fix: In `update()`, when `validFrom` moves later, also re-open the previously auto-ended predecessor (clear its `validTo` if it was set to the old increase date), or otherwise reconcile the gap; add a spec covering "move increase later restores the old rate for the intervening period".

- [MINOR] `apps/api/src/features/cost-tracking/__tests__/cost-tracking.service.spec.ts:306-314` — the update predecessor-sync test does not reflect real transaction visibility
  - Evidence: The "synchronisiert den Vorgaenger bei validFrom-Aenderung" test stubs `findMany` to return only `c1`, never the edited entry `c2`. If `excludeEntryId` were removed from the `endPredecessor` call at `costs.service.ts:478`, the test would still pass (it would just end `c1`), masking the same class of regression the create test was fixed to catch. In a real interactive transaction `findMany` returns both entries.
  - Required fix: Stub `findMany` to include the edited entry (with its old `validFrom`) alongside the predecessor, and assert the update targets the predecessor, not the edited entry.

## Verification
- **Tests/checks reviewed**: `cost-tracking.service.spec.ts` (809 lines) — create predecessor-end test now stubs both entries and asserts `c1` is ended; READ_ONLY rejection specs for `findAll`/`findOne`/`getSchedule`; `cost-tracking.controller.spec.ts` role-guard metadata assertions; `household-isolation.integration.spec.ts` unchanged. i18n `costs.*` key trees in `de.ts`/`en.ts` are in full parity and every key used in TSX exists in both locales (verified all 90 `t('costs.*')` usages).
- **Areas inspected**: `create()`/`endPredecessor`/`update()`/`getSchedule`/`getHouseholdSummary` in the service; DTO null-handling; controller routes and `@Roles`; `costs-overview-card.tsx` (reload, handleUpdate, dropdown); `household/costs/page.tsx` (Q5 overview + SVG chart); `policies/[id]/page.tsx` tab integration; nav-config; confirmed the old `policies/[id]/costs/page.tsx` is deleted and no dead endpoints (`overview`/`annual`/`compare`/`paid-history`) remain.
- **Remaining risks**: The `update()` gap issue (Medium) is the only correctness concern; it is pre-existing (not introduced by the round-1 fixes) but within the working-tree diff. No security leak found — every read/write path remains household- or share-gated.

## Overall verdict

All five round-1 findings are correctly and verifiably fixed, and the create-regression test now genuinely fails if the fix is reverted. The package is otherwise structurally sound with full i18n parity, correct period arithmetic, and no dead endpoints. However, the `update()` path can leave a coverage gap when an increase entry's `validFrom` is moved later (predecessor not restored), which under-reports `paidToDate` and violates the "exactly one entry applies" contract — a Medium issue. With 0 Critical / 0 High / 1 Medium / 1 Minor, the acceptance gate (0/0/0/≤8) is not met, so the verdict is **CHANGES REQUIRED**.

---

## Round-3 response (fixes applied after this review)

1. **Medium (update gap):** added `restorePredecessor` in `cost-tracking.service.ts` — when `validFrom` moves later, the entry auto-ended at the *old* validFrom (`validTo == oldValidFrom - 1ms`) is re-opened (`validTo: null`) BEFORE `endPredecessor` re-syncs the new boundary; added the same re-open to `remove()` (deleting an increase entry restores the old rate). New spec covers the exact reviewer scenario (c1 auto-ended 2024-12-31, c2 moved 2025-01-01 → 2027-01-01: c1 re-opened then ended at 2026-12-31, no gap) plus a remove-restore spec.
2. **Minor (test visibility):** the update predecessor-sync test now stubs `findMany` with both the predecessor and the edited entry (real transaction visibility).
