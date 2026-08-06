# BugFix-08 Review Round 4

Date: 2026-08-06

Work package: `prompts/BugFix-08-costs-overhaul-and-overview-page.md`

Reviewed by: code-reviewer subagent (`ses_02874dad6ffeXpLhOfp4IF8i40`)

Verdict: PASS (0 Critical / 0 High / 0 Medium / 2 Minor)

---

## Review result (verbatim)

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 2
- Verdict: PASS

## Findings

- [Minor] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:488-494` — The fix cannot distinguish an auto-set `validTo` from a manually-set one, so a user's explicit end date can be silently cleared.
  - Evidence: The guard clears `finalValidTo = null` whenever `dto.validTo === undefined` and the existing `validTo <= finalValidFrom`. This is correct for the auto-ended case, but if a user had manually set a fixed `validTo` on an entry and then moves `validFrom` forward past it (without re-sending `validTo`), the manual end date is silently discarded and the entry becomes open-ended. The data model carries no flag to tell the two apart.
  - Required fix: Acceptable as-is given the reconciliation intent, but consider documenting the limitation, or (if manual end dates must be preserved) only auto-clear when the stale `validTo` equals exactly `validFrom - 1ms` (the signature of an auto-end), leaving other stale values to be rejected.

- [Minor] `apps/api/src/features/cost-tracking/cost-tracking.service.ts:522-525` — Moving the FIRST entry forward past its own auto-ended `validTo` leaves a coverage gap.
  - Evidence: When the entry being moved is the earliest entry (no predecessor), `restorePredecessor` finds nothing (returns false), so the period between the original `validFrom` and the next entry's `validFrom` is left without any valid entry, violating the "exactly one entry at any time" invariant. This is reachable because the first entry can be auto-ended by a later increase, and the UI allows moving its `validFrom` forward. The middle-entry case (covered by the new spec) is handled correctly; only the first-entry variant is not.
  - Fix: For the first-entry-forwarded case, consider ending the next entry at the original `validFrom - 1ms` (or otherwise bridging the gap) so no period is left uncovered, or explicitly reject the move when no predecessor exists to restore.

## Verification
- Reviewed `cost-tracking.service.ts` (round-3 fix, create/update/remove, schedule/summary), DTO, controller, module, and all three test files.
- Confirmed the round-3 fix: explicit `validTo <= validFrom` still throws (existing spec line 267-284); implicit stale `validTo` is cleared and persisted as `null`; `restorePredecessor` + `endPredecessor` correctly reconcile the middle-entry case; the new spec (lines 398-451) asserts the main update (`validFrom 2026-01-01`, `validTo null`), c1 reopened, and c3 ended at `2025-12-31T23:59:59.999Z`, and would fail if the guard were reverted.
- Edge cases traced: moving `validFrom` earlier (guard unaffected, `endPredecessor` re-ends predecessor correctly), explicit `validTo` rejection, `remove()` with `restorePredecessor`, `create()` with `endPredecessor(excludeEntryId)`.
- Security: household isolation enforced via `assertHouseholdAccess`/`assertPolicyReadAccess`; READ_ONLY restricted via `getReadablePolicyIds`/`hasPolicyReadShare`; role guards on all controller routes (READ_ONLY only on read endpoints). No issues.
- i18n: `costs.*` and `policies.tabs.costs` keys present and identical in `de.ts`/`en.ts`; parity spec enforces the key tree.
- Dead references: no remaining references to the removed `/policies/[id]/costs` page or the removed `overview/annual/compare/paid-history` endpoints (only a descriptive comment in the controller).
- Remaining risks: the two Minor edge cases above; otherwise the fix is sound and well-tested.

## Overall verdict
The round-3 fix is correct and well-tested: the explicit-vs-implicit `validTo` distinction never masks a user-sent contradictory value, the three-part reconciliation closes the middle-entry invariant, and the new spec reliably catches a regression. The broader sweep found no Critical, High, or Medium issues; only two Minor edge cases remain (manual `validTo` being silently cleared, and a gap when the first entry is moved forward). Acceptance check: 0 Critical / 0 High / 0 Medium / 2 Minor (≤8) → **PASS**.

---

## Round-5 response (fixes applied after this review)

Both Minor findings were addressed as reasonable and safe:

1. **Minor 1 (manual validTo silently cleared):** the auto-clear branch now requires the auto-end signature — a successor entry must start exactly one millisecond after the existing `validTo` (`findFirst` on `validFrom == existing.validTo + 1ms`). Only then is the stale auto-end cleared; a manually set `validTo` without that signature keeps the `BadRequestException('validTo muss nach validFrom liegen')`, so manual end dates are never silently discarded. New spec "manuell gesetztes validTo wird bei validFrom-Verschiebung nicht stillschweigend entfernt (Review 4)"; the middle-entry spec's mocks now include the signature check.
2. **Minor 2 (first-entry move gap):** documented as an accepted limitation in `update()` (gaps are allowed in the model — `entryForPeriod` explicitly returns null for "Kostenrueckgang/Luecke"; blocking the move would break legitimate single-entry start-date corrections, and bridging would fabricate or alter other entries' data).
