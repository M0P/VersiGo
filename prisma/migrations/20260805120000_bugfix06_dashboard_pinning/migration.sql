-- BugFix-06 (Teil 4): Dashboard pinning.
-- Policies can be pinned to the dashboard by the household. A nullable
-- pinnedAt timestamp stores the pin (null = not pinned); the pin order
-- follows the timestamp, newest first.
ALTER TABLE "insurance_policies" ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "insurance_policies_pinnedAt_idx" ON "insurance_policies" ("pinnedAt");
