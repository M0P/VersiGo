# BugFix-08 Review Round 3

Date: 2026-08-06

Work package: `prompts/BugFix-08-costs-overhaul-and-overview-page.md`

Reviewed by: code-reviewer subagent (`ses_0287db6bbffeBSUYcLYz15gEOF`)

Verdict: CHANGES REQUIRED

---

## Review result (verbatim)

## Summary
- Critical: 0
- High: 0
- Medium: 1
- Minor: 0
- Verdict: CHANGES REQUIRED

## Findings

- [Medium] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:496-520` — Moving an auto-ended entry's `validFrom` forward past its own `validTo` leaves a stale `validTo < validFrom`, silently disabling the entry.
  - Evidence: In the middle-entry case (c1 2024, c2 2025, c3 2025-06), c2 was auto-ended by c3 (`validTo=2025-05-31`). When `update()` moves c2 to 2026-01-01, the `data.validTo` is `undefined` (not in the DTO), so Prisma leaves it at `2025-05-31`. `restorePredecessor` only re-opens the *predecessor* (c1) and `endPredecessor` only re-ends the entry valid at the new boundary (c3); neither clears c2's own `validTo`. `entryForPeriod` then filters c2 out for every period (`validTo < periodStart`), so the intended increase never applies and the old c1 rate continues indefinitely. The round-2 spec "validFrom nach hinten verschoben" does not catch this because its mock gives c2 `validTo: null` (line 348), and no spec covers the middle-entry case where the moved entry carries a stale `validTo`.
  - Required fix: In `update()`, when `finalValidFrom > existing.validFrom` and the entry's existing `validTo` is before `finalValidFrom`, clear `validTo` (set to `null`) so the moved entry is re-opened and applies from its new `validFrom` (analogous to `restorePredecessor` but for the moved entry itself). Add a spec for the middle-entry scenario (c1/c2/c3, move c2 past c3) asserting c2 becomes active from the new date and c3 is ended at the new boundary.

## Verification
- Reviewed `cost-tracking.service.ts` (create/update/remove/restorePredecessor/endPredecessor/getSchedule/getHouseholdSummary), controller route ordering (`schedule` before `:entryId`), DTO, module, both spec files, web `household/costs/page.tsx`, `costs-overview-card.tsx`, policy detail tab, nav-config, i18n en/de parity (all `costs.*` keys used in TSX exist in both locales; catalog-parity test enforces identical key trees), Prisma schema (no schema change needed), and the compose smoke test.
- Confirmed the round-2 fixes work as intended: `restorePredecessor` correctly re-opens the auto-ended predecessor in `update()` (move-later) and `remove()`; the two new specs genuinely fail if the restore call is removed (the `validTo: null` update assertion would not fire). The restore-then-`endPredecessor` ordering is functionally irrelevant because `entryForPeriod`'s largest-`validFrom` tie-break yields the same final state either way.
- No dead endpoints remain (`overview`/`annual`/`compare`/`paid-history` only in doc comments/handoff prompts); i18n parity holds; READ_ONLY isolation is enforced via `assertPolicyReadAccess`/`getReadablePolicyIds`.
- Remaining risk: the stale-`validTo` defect above is the only correctness gap found; it is untested and reachable through the UI's edit-validFrom path.

## Overall verdict

The round-2 fixes (restorePredecessor in update/remove and the transaction-visibility test stubs) are correct and well-tested, and no regressions or security issues were found. However, the review-focus middle-entry case exposes a genuine correctness defect: moving an auto-ended entry's `validFrom` forward past its own `validTo` leaves the entry dead, so the intended rate increase is silently lost. This is a Medium finding, so the acceptance check (0 Critical / 0 High / 0 Medium / ≤8 Minor) is not met — **CHANGES REQUIRED**.

---

## Round-4 response (fixes applied after this review)

1. **Medium (stale auto-end validTo on the moved entry):** in `update()`, the `validTo <= validFrom` guard now distinguishes explicit from implicit `validTo`. If the user explicitly sent a contradictory `validTo`, the request is still rejected with the German BadRequest (no masking of user errors). If `validTo` was NOT sent (it comes from the automatic end triggered by a later increase), the stale auto-end is cleared (`finalValidTo = null`; the main update writes `validTo: null`), so the moved increase applies from its new `validFrom`. Combined with the existing `restorePredecessor`/`endPredecessor` re-sync, the middle-entry case (c1 2024 / c2 2025 / c3 2025-06; c2 moved to 2026-01-01) now yields: c1 re-opened, c3 ended at 2025-12-31, c2 active from 2026-01-01 — no period without an applying entry.
2. **New spec:** "BugFix-08: validFrom hinter eigenes auto-beendetes validTo verschoben entfernt das veraltete validTo (Middle-Entry, Review 3)" asserts the main update clears c2's validTo, c1 is re-opened, and c3 is ended at the new boundary. Verified: the spec genuinely fails when the fix is reverted (guard throws BadRequestException).
