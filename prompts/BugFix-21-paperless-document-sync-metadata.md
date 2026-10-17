# BugFix-21: Paperless-Dokumente aus dem Sync statt live, Metadaten und Typ-Icon

## Ziel

Nutzerrückmeldung nach der AP-22-Auslieferung (Wortlaut):

> folgende Verbesserungen:
> die automatisch verknüpften paperless dokumente sollen nicht jedes mal live
> geladen werden, es soll einen geteuerten automatischen sync geben und die
> möglichkeit soll bleiben, es manuell zu triggern.
> zudem fehlen metadaten der dokumente, diese müssen in der ui angezeigt werden:
> datum vom dokument
> url zu dem dokument in paperless
> die info "common.uploadedAt" muss nicht angezeigt werden
> "Paperless-Dokument" wird doppelt aufgeführt, einmal reicht
>
> der dokument typ soll durch ein passendes icon dargestellt werden

## Fachliche Anforderungen

### Kein Live-Laden beim Öffnen der Dokumentenliste

- Die Dokumentenliste einer Versicherung (`GET /households/:id/policies/:policyId/documents`)
  darf **keine Paperless-HTTP-Aufrufe** mehr auslösen. Der Deep-Link zu einem
  Paperless-Dokument wird lokal aus der konfigurierten Basis-URL und der
  Paperless-Dokument-ID gebildet (keine Existenzprüfung über die API).
- Ist Paperless nicht konfiguriert, bleibt der Deep-Link `null`.

### Gesteuerter automatischer Sync (bleibt erhalten, wird wirksamer)

- Der bestehende periodische Abgleich (BullMQ-Reconcile-Tick je Policy,
  Intervall `PAPERLESS_TAG_SYNC_INTERVAL_MS`, Default 5 Minuten) bleibt die
  einzige Quelle für automatisch zugeordnete Dokumente.
- Der manuelle Trigger bleibt unverändert verfügbar
  (`POST .../paperless-tag/sync` und „Jetzt aktualisieren" in der UI).
- Der Sync speichert pro Dokument zusätzlich die Metadaten, die die UI
  anzeigt: Dokumentdatum (Paperless `created`) und MIME-Typ
  (Paperless `mime_type`).
- Bei jedem Sync werden die Paperless-abgeleiteten Metadaten automatisch
  verwalteter Dokumente aktualisiert (Titel, Datum, MIME-Typ). Manuell
  verknüpfte und vom Nutzer bearbeitete Werte dürfen **nicht** überschrieben
  werden; nur echte Lücken (NULL) werden gefüllt.

### Metadaten in der UI

- Anzeige des Dokumentdatums (`policies.documentDate`).
- Anzeige der URL zum Dokument in Paperless als Link (nur bei
  automatisch/manuell verknüpften Paperless-Dokumenten mit Deep-Link).
- Die Zeile mit `common.uploadedAt` entfällt vollständig (der Schlüssel
  existiert nicht im Katalog und wurde bisher als Rohschlüssel angezeigt).
- „Paperless-Dokument" (`policies.paperlessLinkedDocument`) wird pro Eintrag
  genau **einmal** gerendert (Metadatenzeile; das zweite Badge in der
  Aktionsspalte entfällt).

### Dokumenttyp als Icon

- Der Dokumententyp wird durch ein passendes Icon dargestellt
  (PDF, Bild, Dokument, Tabelle, sonstiges) statt durch den rohen
  MIME-String.
- Das Icon ist dekorativ, trägt aber einen lokalisierten zugänglichen Namen
  (`role="img"`, `aria-label`/`title` aus dem i18n-Katalog).
- Die Zuordnung MIME-Typ/Dateiendung → Icon-Typ ist eine reine, testbare
  Funktion in `apps/web/src/lib/document-type.ts`.

## Technische Hinweise

- Kein neues Datenmodell, keine Migration: `policy_documents.documentDate` und
  `.mimeType` existieren bereits.
- Keine neuen Laufzeitabhängigkeiten, Umgebungsvariablen, Ports oder Queues;
  der Compose-Stack bleibt unverändert.
- Keine hartkodierten deutschen Texte in `apps/web` (i18n-Guard).

## Akzeptanzkriterien

1. Unit-Tests belegen, dass `PaperlessNgxService.getDeepLink` keinen
   HTTP-Aufruf mehr ausführt und den Link aus der Konfiguration bildet.
2. Unit-Tests belegen, dass der Tag-Sync Dokumentdatum und MIME-Typ persistiert
   und Nutzerwerte manuell verknüpfter Dokumente unangetastet lässt.
3. Der manuelle Link speichert den MIME-Typ des Paperless-Dokuments.
4. Unit-Tests belegen die Typ-Erkennung (MIME-Typ, Dateiendung, Fallback).
5. Ein Guard-Test belegt, dass jeder in `documents-tab.tsx` statisch
   verwendete `t('…')`-Schlüssel im Katalog existiert (verhindert genau den
   Fehler „common.uploadedAt" wird als Rohtext angezeigt).
6. Lint, Typecheck, Build und Tests laufen über Docker Compose fehlerfrei.
7. Dokumentation aktualisiert: `docs/06-integrations.md`,
   `docs/ui-control-matrix.md`, `docs/end-user-guide.md`,
   `docs/05-feature-slices.md`.
