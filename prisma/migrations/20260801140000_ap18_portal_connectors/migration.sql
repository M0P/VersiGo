-- AP-18: Portal-Connectoren – Erweiterung der Portal-Links
-- =========================================================
-- Kernumfang: Deeplinks und Zugangshinweise pro Vertrag.
-- Neue Spalten auf portal_account_links:
--   accessHint          : Freitext-Zugangshinweise (Kernumfang)
--   connectorKey        : optionaler Schluessel eines Connector-Plugins
--                         (z. B. experimenteller Mailbox-/Dokumentenabruf)
--   credentialsEncrypted: optionale Portal-Zugangsdaten, ausschliesslich
--                         AES-256-GCM-verschluesselt (EncryptionPort).
--                         Die API liefert sie nie zurueck (nur
--                         "credentialsSet: true/false").
--   updatedAt           : Zeitstempel der letzten Aenderung (@updatedAt).
-- Bestehende Zeilen bleiben unveraendert; alle neuen Spalten sind optional
-- bzw. erhalten einen Default.

-- AlterTable
ALTER TABLE "portal_account_links" ADD COLUMN "accessHint" TEXT,
ADD COLUMN "connectorKey" TEXT,
ADD COLUMN "credentialsEncrypted" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
