-- Single amount field for cost entries.
--
-- The cost entry used to carry a gross/net pair ("at least one of them",
-- BugFix-22). An end consumer books the amount they actually pay, so the
-- pair only made the form harder to use and the tables twice as wide.
--
-- Migration of existing rows: the recorded GROSS amount wins, because it is
-- the amount actually transferred; a net-only row keeps its value. Rows
-- without any recorded amount can only exist through direct database access
-- (the API has always required at least one amount); they keep their row and
-- are set to 0 so that no note/validity data is silently deleted – they are
-- visible in the UI and can be corrected there.
ALTER TABLE "policy_cost_entries" ADD COLUMN "amount" DECIMAL(65,30);

UPDATE "policy_cost_entries"
SET "amount" = COALESCE("grossAmount", "netAmount", 0);

ALTER TABLE "policy_cost_entries" ALTER COLUMN "amount" SET NOT NULL;
ALTER TABLE "policy_cost_entries" DROP COLUMN "grossAmount";
ALTER TABLE "policy_cost_entries" DROP COLUMN "netAmount";
