-- AP-21: Multi-Language Support
--
-- 1. users.locale wird von "de-DE" (Legacy-Format) auf den neuen
--    Sprachcode "en"/"de" umgestellt. Englisch ist der globale Default.
--    Alle Legacy-Werte (inkl. anderer Locales wie fr-FR, it-IT, es-ES,
--    pt-BR, regionale Varianten) werden sicher auf 'en' normalisiert,
--    damit kein ungueltiger Wert weiterverwendet wird.
-- 2. Die Praeferenz "language" im user_preferences-Katalog ist obsolet:
--    Die Sprache wird kuenftig ausschliesslich ueber users.locale
--    (USER/ADMIN, persistent) bzw. die Sitzung (READ_ONLY, session-only)
--    verwaltet. Historische Eintraege werden entfernt, da sie sich auf
--    das alte Locale-Format bezogen und keinen erneuten Schreibpfad
--    besitzen.

-- Default des Datenbank-Spalten-Defaults aendern (en statt de-DE).
ALTER TABLE "users" ALTER COLUMN "locale" SET DEFAULT 'en';

-- Existierende Legacy-/Regionalwerte auf den sicheren englischen Default
-- normalisieren. SQL kann case-insensitive nur die echten en-/de-Werte
-- erhalten; alle anderen Locales (fr-FR, it-IT, es-ES, pt-BR, de-AT,
-- en-GB, ...) fallen auf 'en' zurueck.
UPDATE "users"
SET "locale" = 'en'
WHERE lower("locale") NOT IN ('en', 'de');

-- Ehemalige Sprach-Praeferenz-Eintraege entfernen (obsolet seit AP-21).
DELETE FROM "user_preferences" WHERE "key" = 'language';
