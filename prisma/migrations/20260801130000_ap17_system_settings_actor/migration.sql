-- AP-17: Akteur und FK fuer UI-aenderbare globale Systemeinstellungen
-- ==================================================================
-- Die Admin-UI (Systemkonfiguration) zeigt pro Schlüssel den Zeitpunkt der
-- letzten UI-Aenderung samt Akteur. Dafuer erhaelt GlobalIntegrationSetting
-- eine nullable updatedByUserId-Spalte mit SetNull-FK auf users(id).
-- Bestehende Zeilen bleiben unveraendert (Spalte ist optional).

-- AlterTable
ALTER TABLE "global_integration_settings" ADD COLUMN "updatedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "global_integration_settings" ADD CONSTRAINT "global_integration_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
