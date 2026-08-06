# BugFix-08 Review Round 5

Date: 2026-08-06

Work package: `prompts/BugFix-08-costs-overhaul-and-overview-page.md`

Reviewed by: code-reviewer subagent (`ses_028712baeffewF8cdY2KB0uVsj`)

Verdict: PASS (0 Critical / 0 High / 0 Medium / 0 Minor)

---

## Review result (verbatim)

## Review result

### Critical
None.

### High
None.

### Medium
None.

### Minor
None.

### Findings detail

**Round-4 fix 1 (auto-clear of manually set validTo) — verified correct and safe.**
- `apps/api/src/features/cost-tracking/cost-tracking.service.ts:500-507` — The implicit branch now requires a genuine auto-end signature: a successor entry starting exactly `finalValidTo + 1ms`. If absent, it throws `BadRequestException('validTo muss nach validFrom liegen')` instead of silently discarding a manual `validTo`. This is correct: `endPredecessor` always sets `validTo = successor.validFrom - 1ms`, so genuine auto-ends always have a successor at exactly `+1ms`; manual end dates (no successor) are preserved.
- **Signature cannot match the edited entry itself:** the `findFirst` runs against the DB *before* the `update` (line 514), so the edited row still holds its old `validFrom`. For the query to match the edited entry, its old `validFrom` would have to equal `finalValidTo + 1ms`, i.e. `validTo == validFrom - 1ms` — invalid data that `create()`/`update()` reject (`validTo muss nach validFrom liegen`). Not reachable via the API.
- **Middle-entry spec mock ordering** (`cost-tracking.service.spec.ts:404-415`) matches the code path exactly: 1) existing (line 475), 2) signature (line 500), 3) collision (line 511), 4) restorePredecessor (line 544). The three `update` mocks (entryId, c1 reopen, c3 re-end) also match the execution order. The `findMany` transaction view correctly excludes the edited entry so `endPredecessor` targets c3.
- **Review-4 spec** (`cost-tracking.service.spec.ts:455-476`) correctly mocks existing + signature=null and asserts the `BadRequestException` rejection.

**Round-4 fix 2 (first-entry gap limitation) — verified as documentation-only.**
- `cost-tracking.service.ts:537-542` — The limitation is documented as accepted (gaps/Kostenrueckgang allowed per `entryForPeriod`); no behavior change. Consistent with the model.

**Whole-diff sweep:**
- **Security/isolation:** `assertPolicyAccess`/`assertHouseholdAccess` guard all mutations; `assertPolicyReadAccess` + `getReadablePolicyIds` enforce READ_ONLY share filtering on `findAll`/`findOne`/`getSchedule`/`getHouseholdSummary`. Integration spec covers cross-household create/read/update/delete/schedule/summary. Role-guard metadata tests present in controller spec.
- **i18n de/en parity:** `costs.*` keys match across both catalogs; parity test (`i18n.spec.ts`) enforces identical key trees and `costs.title` translation.
- **Dead endpoints/pages:** no references to removed `overview`/`annual`/`compare`/`paid-history` or the old `/policies/[id]/costs` page; `CostsOverviewCard` is wired into the policy detail tab; `/household/costs` is linked from nav and dashboard.
- **Conventions:** German API messages, English code/comments; SEMI_ANNUAL restricted to legacy entries in DTO and UI dropdown.
- **Scope discipline:** changes confined to the cost-tracking feature, web costs UI, i18n, and auth read-access helpers.

### Verification
- Reviewed: `cost-tracking.service.ts`, controller, dto, module, all three spec files, `auth.service.ts` (+ read-access specs), web `household/costs/page.tsx`, `costs-overview-card.tsx`, policy detail page, nav-config, icons, and de/en i18n catalogs.
- Confirmed the two round-4 fixes are correct, safe, and well-tested; no new issues introduced.
- Remaining risk: none material. The signature check not excluding `entryId` is unreachable with valid data (would require `validTo < validFrom`), so it is not actionable.

## Overall verdict
The two round-4 Minor fixes are correctly implemented and thoroughly tested: the auto-clear now requires a genuine auto-end successor signature (and cannot match the edited entry itself), and the first-entry gap is documented as an accepted model limitation. The full sweep found no Critical, High, or Medium issues and no new Minor issues. **Acceptance check: 0 Critical / 0 High / 0 Medium / 0 Minor — PASS.**
