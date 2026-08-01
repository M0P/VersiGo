-- AP-16: fehlende Tabelle fuer das bestehende AiExtractionJob-Modell
-- =========================================================
-- Behebt einen vorbestehenden Schema-/DB-Drift aus AP-09: Das Modell
-- "AiExtractionJob" (prisma/schema.prisma, @@map("ai_extraction_jobs"))
-- war in der Datenbank nie durch eine Migration angelegt worden.
--
-- Folge: Der Worker-Prozessor (apps/worker/src/ai-extraction.processor.ts)
-- schreibt in jedem Job Laufzeitstatus in "ai_extraction_jobs" und stuerzte
-- im Compose-Smoke-Test (BullMQ-Roundtrip, Schritt 10) mit
-- "The table public.ai_extraction_jobs does not exist" ab.
--
-- Diese Migration legt das Enum "AiJobStatus" und die Tabelle exakt so an,
-- wie sie Prisma aus dem Modell ableitet (Spalten, Defaults, Indizes, FK).
-- Der bestehende tolerante Pfad des Prozessors (Job ohne DB-Zeile =>
-- findUnique -> null => success:false ohne weiteren DB-Zugriff) funktioniert
-- damit auch fuer Smoke-Test-Jobs, die bewusst keinen DB-Eintrag erzeugen.

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ai_extraction_jobs" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "model" TEXT,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "inputDocumentRef" TEXT,
    "extractedFieldsJson" JSONB,
    "confidenceJson" JSONB,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_extraction_jobs_policyId_idx" ON "ai_extraction_jobs"("policyId");

-- CreateIndex
CREATE INDEX "ai_extraction_jobs_status_idx" ON "ai_extraction_jobs"("status");

-- AddForeignKey
ALTER TABLE "ai_extraction_jobs" ADD CONSTRAINT "ai_extraction_jobs_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
