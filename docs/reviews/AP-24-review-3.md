# AP-24 Review – Round 3

> **Work package:** `BugFix-22-KOSTENBERECHNUNG_BRUTTO_NETTO and AP-24-detailverbesserungen`
> **Starting commit:** `868bc78` · **Branch:** `feature/ap-24-detailverbesserungen`
> **Reviewer:** `code-reviewer` subagent, invoked via Task, session `ses_eaf8effbdffeA2u4PLTxgcH3b2` (continued from rounds 1 and 2)
> **Outcome:** `VERDICT: PASS` — **0 Critical, 0 High, 0 Medium**, 1 Minor (m1, deliberately out of scope).
> Both Medium findings from round 2 were fixed and verified as resolved.
> Acceptance condition met.

---

Both Medium findings are resolved.

**M1 — `cost-tracking.service.spec.ts`**: Three new tests (lines 1194–1241) pin the `where` argument on `insurancePolicy.findFirst` (`{ id: policyId, householdId }`), `policyCostEntry.findFirst` (`{ id: entryId, policyId }`), and both `insurancePolicy.findFirst` + `policyCostEntry.findMany` for `getSchedule`. The gate confirms API tests went 868 → 873, exactly these 3 + M2's 2.

**M2 — `documents.service.spec.ts`**: Two new tests (lines 625–646) pin `insurancePolicy.findFirst` with `{ id: policyId, householdId }` (via `getFilePath`) and `policyDocument.findFirst` with `{ id: docId, policyId, archivedAt: null }` (via `findOne`). Both `where` clauses are now explicitly asserted.

The authoritative gate run (exit 0) shows all 1288 tests passing, lint/typecheck/i18n/license/version all OK, and the Compose smoke test passes.

The Minor finding m1 (string-scan fragility in `bugfix22-ui-guards.spec.ts`) was deliberately not addressed in this work package; it remains a reported observation, not a defect.

No Critical, High, or Medium findings remain. All acceptance criteria are satisfied.

**VERDICT: PASS**
