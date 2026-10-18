-- AP-24 (§3.2 + §4.2): strukturierte KI-Zusammenfassung und Dokumentbezug
-- eines Kosteneintrags.
--
-- Additive Migration (keine Spalten- oder Tabellenentfernung, bestehende
-- Daten bleiben unveraendert lesbar).

-- §3.2: Die KI-Zusammenfassung wird ab AP-24 als validiertes JSON-Dokument
-- (Variante A) gespeichert. `summaryMarkdown` bleibt erhalten und enthaelt
-- bei neuen Eintraegen die reine Textdarstellung derselben Struktur, damit
-- bestehende Konsumenten (Exporte, Altclients) unveraendert weiterlaufen.
-- Bestehende Zeilen behalten `summaryJson = NULL` und werden in der
-- Oberflaeche weiterhin als Markdown dargestellt.
ALTER TABLE "ai_coverage_summaries"
  ADD COLUMN "summaryJson" JSONB;

-- §4.2: Ein Kosteneintrag kennt das Quelldokument, aus dem er abgeleitet
-- wurde. NULL bei manuell erfassten Eintraegen. Beim Loeschen des Dokuments
-- bleibt der Kosteneintrag erhalten (ON DELETE SET NULL) – Kosten duerfen
-- nicht verschwinden, nur weil ein Nachweis entfernt wurde.
ALTER TABLE "policy_cost_entries"
  ADD COLUMN "sourceDocumentId" TEXT;

CREATE INDEX "policy_cost_entries_sourceDocumentId_idx"
  ON "policy_cost_entries"("sourceDocumentId");

ALTER TABLE "policy_cost_entries"
  ADD CONSTRAINT "policy_cost_entries_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "policy_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
