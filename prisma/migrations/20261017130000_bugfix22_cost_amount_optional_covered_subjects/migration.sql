-- BugFix-22: cost entries ("Kostenerhöhung") and insured subjects.

-- 1) Cost entry: gross OR net is sufficient. The gross amount becomes
--    optional; the amount basis of all calculations is "gross if set,
--    otherwise net". Existing rows are unaffected.
ALTER TABLE "policy_cost_entries" ALTER COLUMN "grossAmount" DROP NOT NULL;

-- 2) Insured subjects can be persons or objects (car, house, ...).
--    The relation is no longer mandatory: an object has no relation.
CREATE TYPE "CoveredSubjectType" AS ENUM ('PERSON', 'OBJECT');

ALTER TABLE "covered_persons"
  ADD COLUMN "subjectType" "CoveredSubjectType" NOT NULL DEFAULT 'PERSON';

ALTER TABLE "covered_persons" ALTER COLUMN "relationType" DROP NOT NULL;
