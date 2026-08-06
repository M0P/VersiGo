# BugFix-08 – Costs overhaul + separate costs overview page (Package B, user Q4/Q5)

Source: user batch (2026-08-06) – "improvements: the costs feature needs a general overhaul" (Q4) and "there should be a separate costs overview page" (Q5). Package B per `prompts/BugFix-07-ui-fixes-and-branding.md` ("Out of scope – separate work package for another agent").

## Context (what exists today)

The current cost-tracking feature is considered **too complicated and not user-friendly** ("too many different views to configure it") and must be **completely rebuilt**:

- API module `apps/api/src/features/cost-tracking/` (controller, service, DTOs, specs). Model `PolicyCostEntry` in `prisma/schema.prisma` (`policyId`, `validFrom`, `validTo?`, `grossAmount` DECIMAL, `netAmount?`, `frequency` `PaymentFrequency` MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL, `bookingSource?`, `note?`). `InsurancePolicy` additionally carries legacy fields `paymentFrequency`/`premiumAmount`.
- Existing endpoints: CRUD on `households/:householdId/policies/:policyId/costs` plus `overview`, `annual`, `compare?year=`, `paid-history` and a household `summary` endpoint.
- UI: a separate per-policy costs page `apps/web/src/app/policies/[id]/costs/page.tsx` (annual overview, entries table, paid history, new-entry form) and a household summary page `apps/web/src/app/household/costs/page.tsx`. Both must be reworked/consolidated by this package.

## Scope (Package B only)

### 1. Costs data model & API rebuild (Q4)
- Each insurance must support **adding costs** (already the case at the data level; keep/extend `PolicyCostEntry`).
- **Cost periods:** define costs per **month, quarter, year** (`MONTHLY`, `QUARTERLY`, `ANNUAL`). The existing `SEMI_ANNUAL` value must be handled (keep for existing data or migrate cleanly in a schema migration — decide and document; a data-lossless path is required).
- **Cost increases from a start date:** "es muss möglich sein, die Kosten ab einem bestimmten Zeitpunkt zu erhöhen" — model this as the entry's `validFrom` (and `validTo` on the superseded entry). At any point in time exactly **one entry applies** for a policy (the one with the greatest `validFrom` ≤ period start). An increase = adding a new entry with a later `validFrom`; the previous entry is automatically ended. This must be reflected in all calculations.
- **Table view of incurred and expected costs:** a period-based table (one row per period: period start/end, amount, incurred/expected). Past periods = incurred, future periods = expected (projected from the currently valid entry).
- **Paid-to-date sum:** "wie viel wurde für die Versicherung bis heute gezahlt; die Berechnung ist eine Summe der vergangenen Perioden, kein Tageswert" — the sum over **past periods** (each completed period contributes its full period amount). **No daily/daily-prorated values.**
- **Historic entries must be editable:** PATCH + DELETE for any entry, including past ones (existing API support must be preserved in the rebuild).
- Money handling: keep DECIMAL storage, round displayed/calculated amounts to 2 decimals, never use floats for sums. German API messages (existing convention). Household isolation + role guards (READ_ONLY read-only, USER/ADMIN write) must be preserved, as must the BugFix-06 (Teil 3) semantics: calculation by billing period, not daily-prorated.
- Decide which of the existing endpoints (`overview`, `annual`, `compare`, `paid-history`) survive the rebuild; the UI must not call dead endpoints. Update/extend the service specs accordingly (paid-to-date = sum of past periods and increase-from-date must be explicitly covered by tests, incl. a frequency-change and an increase-mid-year case).

### 2. Costs in the insurance detail view (Q4)
- Costs must be addable **directly in the insurance detail view** (`apps/web/src/app/policies/[id]/page.tsx` or a clearly reachable section/tab from it).
- The section shows: the period-based incurred/expected table, the paid-to-date sum ("bisher gezahlt"), and add/edit/delete controls (incl. editing historic entries). The current separate per-policy costs page (`policies/[id]/costs/page.tsx`) is folded into the detail view — no duplicate configuration views remain.
- UX requirements from the user: simple, one clear place per insurance; each insurance has the possibility to add costs; no hidden multi-view setup flow.

### 3. Separate costs overview page (Q5)
- A dedicated overview page (rework of `apps/web/src/app/household/costs/page.tsx`), reachable from the navigation.
- **Lowest level is the insurance + its total costs so far** (paid-to-date). The goal: "wie viel hat der Nutzer ausgegeben" — per insurance and **per month and per year for all insurances** (total spend, e.g. €/month and €/year across the household).
- **Historic graph:** a chart of the costs per year (e.g. per-year bars/line over the last years) — "vielleicht einen historischen Graphen, der die Kosten pro Jahr zeigt". Keep it dependency-light (an existing chart/design-system pattern is preferred; no heavy new chart library without justification).
- Aggregation must use the same "sum of past periods" semantics as the per-policy paid-to-date (no daily proration).

### 4. Conventions
- de/en i18n parity for every new/changed UI string (`apps/web/src/i18n/locales/de.ts` + `en.ts`), i18n guard must stay green (no hardcoded German in TSX).
- German API error messages; English code identifiers; follow existing patterns (cards/badges/tables, `PageHeader`, `Alert`, `FormField`).
- Migration via the Compose `migration` service (canonical path, BugFix-07): any schema change must be a new Prisma migration folder in `prisma/migrations/` and work on a fresh clone.
- No further Docker image size work is required in this package (done in BugFix-07: api ~371 MB / worker ~365 MB / web ~207 MB) — the build must simply keep working and not regress sizes.

## Out of scope
- Everything already delivered in BugFix-07 (Package A): admin settings single page, OIDC readiness + self-service account linking, Paperless document linking, portal URL https normalization, branding/favicon, Docker image size reduction.
- Any other feature not listed above.

## Acceptance
- All gates green: `docker compose -f docker-compose.test.yml` unit/integration (vitest), tsc, eslint, i18n guard, `docker compose config`, and `./scripts/compose-smoke-test.sh --build --clean` (fresh-clone contract: `docker compose up --build` works, migrations run via the migration service; rebuild the migration image with `docker compose build migration` after adding a migration — the smoke script does not build it).
- Review loop (code-reviewer subagent via Task tool): write each review verbatim to `docs/reviews/BugFix-08-review-<n>.md`; fix every Critical/High/Medium (and Minor where reasonable) until **0 Critical / 0 High / 0 Medium / ≤ 8 Minor**, max 5 rounds; then commit (message starting `BugFix-08:`), write `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` handoff, and clean up all podman artifacts per AGENTS.md.
- The costs rebuild must demonstrably remove the "too many views" complexity: one place to manage costs per insurance (detail view) + one household overview page.
