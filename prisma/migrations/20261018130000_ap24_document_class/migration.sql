-- AP-24 (§2): Dokumentklassifikation
--
-- Additive Migration (keine Spalten- oder Tabellenentfernung, keine
-- Aenderung bestehender Spalten-Defaults aus Sicht der Anwendung):
--
-- 1) DocumentClass: stabile technische Klassen-Schluessel. CONTRACT und
--    BILLING sind verbindlich (waehlbare Vertragsdokumente der KI-
--    Zusammenfassung beziehungsweise Abrechnungsliste der Kostenansicht),
--    die uebrigen Klassen sind Vorschlaege.
-- 2) policy_documents.documentClass: Klasse JE Versicherungs-Zuordnung
--    (nicht je externes Dokument – dieselbe Paperless-Quelle kann bei
--    einer Versicherung eine Rechnung und bei einer anderen Korrespondenz
--    sein).
--
-- Bestehende Dokumente werden als UNCLASSIFIED uebernommen (Spalten-Default).
-- Es erfolgt KEINE automatische inhaltliche Klassifikation; die Klassifi-
-- kation wird auch nicht von der Tag-Synchronisation ueberschrieben.

CREATE TYPE "DocumentClass" AS ENUM (
  'CONTRACT',
  'BILLING',
  'CORRESPONDENCE',
  'CLAIM',
  'OTHER',
  'UNCLASSIFIED'
);

ALTER TABLE "policy_documents"
  ADD COLUMN "documentClass" "DocumentClass" NOT NULL DEFAULT 'UNCLASSIFIED';
