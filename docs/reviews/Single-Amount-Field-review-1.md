# Review: Single Amount Field (Brutto aus der gesamten Anwendung entfernen)

- Work package: `feature/single-amount-field` – ein einzelnes Betragssfeld statt Brutto/Netto,
  zusätzlich die UI-Meldung, dass bestehende Kostenpositionen wegen zu schmaler Felder nicht mehr
  bearbeitbar waren.
- Starting commit: `f17393e`
- Review iteration: 1
- Reviewed by: `code-reviewer` (independent subagent, read-only)
- Review input: full diff `/tmp/opencode/wp-single-amount-diff-1.txt`, gate log
  `/tmp/opencode/single-amount-gate2.log`

---

Now I have a thorough understanding of the change set. Let me compile the review.

# Review result

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Minor: 0
- Verdict: PASS

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Remove "Brutto" (gross/net) from the entire application | PASS | All gross/net references removed from DB (Prisma schema + migration), API (DTOs, services, schedule maths), UI (components, i18n, formatting), privacy export, and AI extraction prompt. |
| Collapse gross/net pair into single `amount` field across all layers | PASS | DB: `amount Decimal` (NOT NULL). API: `CreateCostEntryDto.amount` required, `UpdateCostEntryDto.amount` optional but guarded. Calculation: `Amount = number \| null` type, `sumAmounts`/`periodAmount`/`computePolicySchedule`/`summarizePolicyCosts` all single-basis. UI: one amount column/input, `parseCostAmount` helper, `formatAmount` formatter. |
| Data migration: gross wins when both present; net-only keeps value; neither → 0 but row kept | PASS | Migration SQL: `COALESCE("grossAmount", "netAmount", 0)` → `amount` NOT NULL, then drops old columns. Verified against throwaway Postgres: (1200.50, 1000.00)→1200.50; (99.99, NULL)→99.99; (NULL, 77.77)→77.77; (NULL, NULL)→0. |
| "Amount is required" rule enforced on create and update | PASS | Create: DTO has required `amount`, service checks `dto.amount == null`. Update: DTO optional, service computes `nextAmount` and rejects `null`. Tested in `cost-tracking.service.spec.ts` (create without amount rejected, update to null rejected). |
| UI defect fix: full-width edit row with responsive grid | PASS | `costs-overview-card.tsx` edit row uses `<td colSpan={6}>` with `.cost-entry-edit` grid (`repeat(auto-fit, minmax(11rem, 1fr))`) and separate `.cost-entry-edit-actions` row. Regression guard in `bugfix22-ui-guards.spec.ts` verifies `colSpan={6}`, grid class, and single amount input. |
| BugFix-08/22 calculation semantics preserved | PASS | `cost-schedule.ts`: anchor = earliest of policy start and first entry; paid-to-date = full amounts of started periods (no day shares); uncovered periods = `null` (never 0); integer-cent sums with 2-decimal rounding. All unit tests pass (24 tests in `cost-schedule.spec.ts`, 877 API tests total). |
| i18n completeness: old keys removed, new keys in both locales | PASS | Removed: `gross`, `net`, `basisGross`, `basisNet`, `grossAmount`, `netAmount`, `annualGross`, `annualNet`, `amountGross`, `amountNet`. Added: `annual`, `amount`, `amountHint`, `amountRequired` — all present in `de.ts` and `en.ts`. No code references to removed keys (verified by grep). |
| Scope discipline: no unrelated refactors | PASS | Changes strictly limited to single-amount-field removal and UI edit-row fix. No formatting-only churn, no dependency changes, no unrelated refactoring. |
| Test quality: meaningful assertions, no weakening | PASS | 1293 tests pass (877 API, 122 foundation, 235 web, 59 worker). TDD approach: `cost-schedule.spec.ts` written first (observed failing against old impl). Assertions strengthened (e.g., explicit `toBeNull()` for uncovered periods, `sumAmounts` tests for null/empty/zero). `as never` casts only for test mock wiring and one intentional invalid-input test. |

## Findings

No findings.

## Verification

- Change set reviewed: `f17393e..feature/single-amount-field` (diff at `/tmp/opencode/wp-single-amount-diff-1.txt`, 3187 lines including new migration file).
- Checks with supplied output: Docker Compose gate (`docker compose -f docker-compose.test.yml down -v && podman build -f Dockerfile.test --target build -t versigo-test:latest . && docker compose -f docker-compose.test.yml up --no-build --abort-on-container-exit --exit-code-from test`) — **EXIT 0**, full log at `/tmp/opencode/single-amount-gate2.log`. All stages passed: Prisma migration (22 applied, including `20261018160000_single_amount_field`), lint (3/3), typecheck (4/4), tests (1293 passed), license check, version sync, i18n guard.
- Checks not independently run: All checks run in Docker Compose test stack; shell access is disabled for this reviewer, but the supplied log is complete and authoritative.
- Important areas inspected: `prisma/schema.prisma`, migration SQL, `cost-schedule.ts`, `cost-tracking.service.ts`, `cost-tracking.dto.ts`, `costs-overview-card.tsx`, `globals.css`, i18n locales, privacy export, AI extraction format, all updated test suites.
- Remaining risks: None identified. The migration is idempotent and data-safe; calculation logic is pure and unit-tested; UI edit row is guarded by regression test; i18n keys are complete.

VERDICT: PASS
