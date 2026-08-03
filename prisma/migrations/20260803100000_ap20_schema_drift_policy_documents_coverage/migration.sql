-- AP-20: vorbestehender Schema-/DB-Drift (Policy-Dokumente, Portal-Links, AI-Deckungszusammenfassungen)
-- =========================================================
-- Behebt einen vorbestehenden Schema-/DB-Drift: Die Modelle
-- "PolicyDocument" (policy_documents), "PortalAccountLink" (portal_account_links)
-- und "AiCoverageSummary" (ai_coverage_summaries) wurden im Schema
-- (prisma/schema.prisma) weiterentwickelt (AP-09/AP-14), ohne dass passende
-- Migrationen angelegt wurden.
--
-- Folge: Der Policy-Registry-Erstellpfad (POST /households/default/policies)
-- schlug im Compose-Smoke-Test (Schritt 8p) mit P2022 ab:
-- "The column policy_documents.fileSize does not exist in the current database."
-- Da insurancePolicy.create() das include-Dokumente mit allen Spalten selektiert,
-- war der zentrale Kern-Flow (Policy anlegen) in keiner Installation nutzbar.
--
-- Diese Migration gleicht die Datenbank additiv an das Schema an:
-- 1. policy_documents: fehlende Spalten (aiProcessingExcluded, archivedAt,
--    createdByUserId, documentVersion, fileSize, uploadedAt), storageType-Default,
--    Index (policyId, checksum), FK auf users (ON DELETE SET NULL).
-- 2. portal_account_links: syncStatus wird NOT NULL (vorher NULL-Backfill auf
--    'PENDING' fuer bestehende Zeilen) und der updatedAt-Default entfernt.
-- 3. ai_coverage_summaries: fehlende Tabelle (Modell aus AP-09), inkl. Index + FK.
-- Alle Aenderungen sind additiv und rueckwaertskompatibel (siehe
-- docs/08-admin-operations.md, Upgrade-/Rollback-Kapitel; Rueckbau nur
-- ueber Backup-Wiederherstellung, keine automatische Downgrade-Migration).

-- Backfill: vorhandene Zeilen mit NULL-syncStatus auf 'PENDING' setzen,
-- damit ALTER TABLE ... SET NOT NULL sicher ist.
UPDATE "portal_account_links" SET "syncStatus" = 'PENDING' WHERE "syncStatus" IS NULL;

-- AlterTable
ALTER TABLE "policy_documents" ADD COLUMN     "aiProcessingExcluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "documentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "storageType" SET DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "portal_account_links" ALTER COLUMN "syncStatus" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ai_coverage_summaries" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "model" TEXT,
    "summaryMarkdown" TEXT NOT NULL,
    "sourceDocumentRefsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_coverage_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_coverage_summaries_policyId_idx" ON "ai_coverage_summaries"("policyId");

-- CreateIndex
CREATE INDEX "policy_documents_policyId_checksum_idx" ON "policy_documents"("policyId", "checksum");

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_coverage_summaries" ADD CONSTRAINT "ai_coverage_summaries_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
