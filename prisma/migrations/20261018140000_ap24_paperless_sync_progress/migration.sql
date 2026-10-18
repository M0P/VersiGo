-- AP-24 (§1.1): Fortschrittsanzeige beim manuellen Paperless-Abgleich
--
-- Additive Migration (keine Spalten- oder Tabellenentfernung, keine
-- Aenderung bestehender Spalten-Defaults aus Sicht der Anwendung):
--
-- paperless_tag_jobs erhaelt Zaehler, mit denen die Oberflaeche einen
-- laufenden SYNC_POLICY-Abgleich darstellen kann.
--
--   processedCount  – bereits verarbeitete Dokumente (Zwischenstand)
--   totalCount      – Gesamtzahl, soweit ermittelbar. NULL, solange sie
--                     nicht feststeht: die Oberflaeche zeigt dann einen
--                     UNBESTIMMTEN Fortschrittsbalken mit dem Zwischenstand
--                     statt eines vorgetaeuschten Prozentwerts.
--   addedCount      – neu zugeordnete Dokumente
--   removedCount    – entfernte Zuordnungen
--   unchangedCount  – unveraenderte Zuordnungen
--
-- Die Zaehler sind NICHT sensitiv: sie enthalten keine Dokumentinhalte,
-- Titel oder Zugangsdaten, sondern nur Mengen. Bestehende Zeilen behalten
-- ihre alten Werte (Default 0 / NULL); ein erneuter Lauf setzt sie neu.

ALTER TABLE "paperless_tag_jobs"
  ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalCount" INTEGER,
  ADD COLUMN "addedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "removedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unchangedCount" INTEGER NOT NULL DEFAULT 0;
