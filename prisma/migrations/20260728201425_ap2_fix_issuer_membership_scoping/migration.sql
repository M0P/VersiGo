/*
  Datenerhaltende Migration: bestehende globale und Household-spezifische
  Feature-Flags sowie Integration-Settings werden in die neuen getrennten
  Tabellen kopiert, bevor die alten Tabellen entfernt werden. oidcIssuer
  wird zunaechst nullable angelegt, mit einem Platzhalter befuellt und erst
  danach NOT NULL gesetzt, damit bestehende User-Datensaetze nicht zum
  Fehlschlagen der Migration fuehren.

  Warnings:
  - Bestehende users-Datensaetze ohne bekannten Issuer erhalten den
    Platzhalter 'unknown'. Vor produktivem OIDC-Rollout muss dieser Wert
    ueber ein Datenmigrationsskript auf den tatsaechlichen Issuer korrigiert
    werden.
*/

-- AlterTable: oidcIssuer zunaechst nullable anlegen
ALTER TABLE "users" ADD COLUMN "oidcIssuer" TEXT;

-- Backfill: bestehende Datensaetze erhalten einen Platzhalter-Issuer
UPDATE "users" SET "oidcIssuer" = 'unknown' WHERE "oidcIssuer" IS NULL;

-- AlterTable: Spalte erst nach Backfill verpflichtend machen
ALTER TABLE "users" ALTER COLUMN "oidcIssuer" SET NOT NULL;

-- DropIndex: alte, nur auf oidcSubject basierende Eindeutigkeit entfernen
DROP INDEX "users_oidcSubject_key";

-- CreateIndex: neue, issuer-gescopte Eindeutigkeit
CREATE UNIQUE INDEX "users_oidcIssuer_oidcSubject_key" ON "users"("oidcIssuer", "oidcSubject");

-- CreateTable: neue getrennte Settings-/Flag-Tabellen anlegen, bevor
-- Daten migriert und die alten Tabellen entfernt werden
CREATE TABLE "global_integration_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT,
    "valuePlain" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_integration_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "household_integration_settings" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEncrypted" TEXT,
    "valuePlain" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_integration_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "global_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "household_feature_flags" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Eindeutigkeit und Lookup-Indizes fuer die neuen Tabellen
CREATE UNIQUE INDEX "global_integration_settings_key_key" ON "global_integration_settings"("key");
CREATE INDEX "household_integration_settings_householdId_idx" ON "household_integration_settings"("householdId");
CREATE UNIQUE INDEX "household_integration_settings_householdId_key_key" ON "household_integration_settings"("householdId", "key");
CREATE UNIQUE INDEX "global_feature_flags_key_key" ON "global_feature_flags"("key");
CREATE INDEX "household_feature_flags_householdId_idx" ON "household_feature_flags"("householdId");
CREATE UNIQUE INDEX "household_feature_flags_householdId_key_key" ON "household_feature_flags"("householdId", "key");

-- DataMigration: bestehende globale Integration-Settings uebernehmen
-- (householdId IS NULL entsprach zuvor "global" in der alten scopeKey-Logik)
INSERT INTO "global_integration_settings" ("id", "key", "valueEncrypted", "valuePlain", "isSecret", "createdAt", "updatedAt")
SELECT "id", "key", "valueEncrypted", "valuePlain", "isSecret", "createdAt", "updatedAt"
FROM "integration_settings"
WHERE "householdId" IS NULL;

-- DataMigration: bestehende Household-Integration-Settings uebernehmen
INSERT INTO "household_integration_settings" ("id", "householdId", "key", "valueEncrypted", "valuePlain", "isSecret", "createdAt", "updatedAt")
SELECT "id", "householdId", "key", "valueEncrypted", "valuePlain", "isSecret", "createdAt", "updatedAt"
FROM "integration_settings"
WHERE "householdId" IS NOT NULL;

-- DataMigration: bestehende globale Feature-Flags uebernehmen
INSERT INTO "global_feature_flags" ("id", "key", "enabled", "createdAt", "updatedAt")
SELECT "id", "key", "enabled", "createdAt", "updatedAt"
FROM "feature_flags"
WHERE "householdId" IS NULL;

-- DataMigration: bestehende Household-Feature-Flags uebernehmen
INSERT INTO "household_feature_flags" ("id", "householdId", "key", "enabled", "createdAt", "updatedAt")
SELECT "id", "householdId", "key", "enabled", "createdAt", "updatedAt"
FROM "feature_flags"
WHERE "householdId" IS NOT NULL;

-- DropForeignKey: alte Constraints entfernen, erst nachdem die Daten
-- vollstaendig in die neuen Tabellen uebernommen wurden
ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_householdId_fkey";
ALTER TABLE "integration_settings" DROP CONSTRAINT "integration_settings_householdId_fkey";
ALTER TABLE "object_shares" DROP CONSTRAINT "object_shares_sourceUserId_fkey";
ALTER TABLE "object_shares" DROP CONSTRAINT "object_shares_targetUserId_fkey";

-- DropTable: alte Tabellen erst nach erfolgreicher Datenuebernahme entfernen
DROP TABLE "feature_flags";
DROP TABLE "integration_settings";

-- AddForeignKey: neue, membership-gebundene Fremdschluessel fuer ObjectShare
ALTER TABLE "object_shares" ADD CONSTRAINT "object_shares_householdId_sourceUserId_fkey" FOREIGN KEY ("householdId", "sourceUserId") REFERENCES "household_memberships"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_shares" ADD CONSTRAINT "object_shares_householdId_targetUserId_fkey" FOREIGN KEY ("householdId", "targetUserId") REFERENCES "household_memberships"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: neue Settings-Tabellen an households binden
ALTER TABLE "household_integration_settings" ADD CONSTRAINT "household_integration_settings_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_feature_flags" ADD CONSTRAINT "household_feature_flags_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
