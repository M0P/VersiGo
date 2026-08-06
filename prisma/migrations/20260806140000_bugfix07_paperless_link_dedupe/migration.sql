-- BugFix-07 (Code-Review, Minor): Race-feste Deduplizierung von
-- Paperless-Verknuepfungen (PAPERLESS_LINK) pro (policyId, storageRef).
--
-- Der App-Code fuehrt den Check-then-Insert jetzt in EINER Transaktion aus;
-- dieser partielle Unique-Index faengt den verlierenden Writer bei parallelen
-- Requests ab (Prisma P2002 -> idempotenter Rueckgriff auf den Bestand).
--
-- Partialitaet: Nur nicht-archivierte PAPERLESS_LINK-Zeilen sind eindeutig,
-- damit ein Dokument nach dem Archivieren erneut verknuepft werden kann.

-- 1) Bestehende Duplikate bereinigen: pro (policyId, storageRef) bleibt der
--    frueheste Eintrag (niedrigste uploadedAt, bei Gleichstand kleinste id).
DELETE FROM "policy_documents" a
WHERE a."storageType" = 'PAPERLESS_LINK'
  AND a."archivedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "policy_documents" b
    WHERE b."policyId" = a."policyId"
      AND b."storageRef" = a."storageRef"
      AND b."storageType" = 'PAPERLESS_LINK'
      AND b."archivedAt" IS NULL
      AND (b."uploadedAt" < a."uploadedAt"
           OR (b."uploadedAt" = a."uploadedAt" AND b."id" < a."id"))
  );

-- 2) Partieller Unique-Index als letzte Verteidigungslinie.
CREATE UNIQUE INDEX "policy_documents_policyId_storageRef_key"
  ON "policy_documents" ("policyId", "storageRef")
  WHERE "archivedAt" IS NULL AND "storageType" = 'PAPERLESS_LINK';
