-- AP-22: Tag-basierte Dokumentzuordnung mit Paperless-ngx
--
-- Additive Migration (keine Spalten- oder Tabellenentfernung, keine
-- Aenderung bestehender Spalten-Defaults aus Sicht der Anwendung):
--
-- 1) policy_documents: unabhaengige Herkunftsinformationen
--    (linkOriginManual / linkOriginTag) + Tagging-Status fuer manuell
--    verlinkte Dokumente. Bestehende PAPERLESS_LINK-Zeilen wurden
--    ausschliesslich manuell verknuepft (BugFix-07) und werden deshalb
--    als MANUEL uebernommen. Alle bestehenden Dokumentdaten bleiben
--    erhalten; die Migration fuehrt keine externen Paperless-Aufrufe aus.
-- 2) policy_paperless_tags: optionale Tag-Konfiguration je Versicherung
--    (Referenz auf die verwendete Paperless-Verbindung, externe Tag-ID als
--    stabile Referenz, Anzeige-Name als Cache, Konfigurationsversion gegen
--    veraltete Jobs, letzter Abgleich + Status + nicht sensitiver
--    Fehlercode).
-- 3) paperless_tag_jobs: dauerhafte Job-Erfassung (Outbox-Aequivalent)
--    fuer Tagging-Auftraege.

-- Enum-Typen
CREATE TYPE "PaperlessTaggingStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED');
CREATE TYPE "PaperlessTagJobKind" AS ENUM ('SYNC_POLICY', 'TAG_DOCUMENT');

-- 1) policy_documents erweitern
ALTER TABLE "policy_documents"
  ADD COLUMN "linkOriginManual" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "linkOriginTag" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taggingStatus" "PaperlessTaggingStatus",
  ADD COLUMN "taggingErrorCode" TEXT;

-- Bestehende aktive Paperless-Links waren stets manuelle Verknuepfungen.
UPDATE "policy_documents"
SET "linkOriginManual" = true
WHERE "storageType" = 'PAPERLESS_LINK';

-- 2) Tag-Konfiguration je Versicherung (max. ein Tag pro Versicherung)
CREATE TABLE "policy_paperless_tags" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "connectionRef" TEXT,
    "paperlessTagId" INTEGER NOT NULL,
    "paperlessTagName" TEXT,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_paperless_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "policy_paperless_tags_policyId_key"
  ON "policy_paperless_tags"("policyId");
CREATE INDEX "policy_paperless_tags_paperlessTagId_idx"
  ON "policy_paperless_tags"("paperlessTagId");

ALTER TABLE "policy_paperless_tags"
  ADD CONSTRAINT "policy_paperless_tags_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Dauerhafte Job-Erfassung
CREATE TABLE "paperless_tag_jobs" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "documentId" TEXT,
    "kind" "PaperlessTagJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "configVersion" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "paperless_tag_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "paperless_tag_jobs_policyId_status_idx"
  ON "paperless_tag_jobs"("policyId", "status");
CREATE INDEX "paperless_tag_jobs_status_idx"
  ON "paperless_tag_jobs"("status");

ALTER TABLE "paperless_tag_jobs"
  ADD CONSTRAINT "paperless_tag_jobs_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
