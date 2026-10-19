# Integrationen

## AI Provider Abstraktion
Ein einheitliches Provider-Interface:
- `extractContractFacts(documentRefs, schema)`
- `summarizeCoverage(policyId, documentRefs, promptProfile)` –
  AP-24 §3.2: liefert das strukturierte JSON-Dokument (siehe unten)
- `extractCostFromDocument(documentContent, policyId, options?)` –
  AP-24 §4.2, **optional**; `healthStatus()` ist ebenso optional. Ein Adapter,
  der die Methode nicht bereitstellt, kann weiterhin zusammenfassen und
  Fakten extrahieren – `AiAssistService` lehnt `POST …/cost-suggestion`
  in diesem Fall mit `AI_COST_EXTRACTION_UNSUPPORTED` ab, statt einen
  Adapterwechsel zu erzwingen.
- `healthCheck()` bzw. `healthStatus()`

### Provider
- Ollama Adapter, lokal oder remote
- OpenAI-kompatibler Adapter
- Weitere kompatible Endpunkte per Basis-URL und API-Key

### Dokumentinhalte der KI-Aufrufe (AP-25)

Bis AP-25 wurde einem Provider nur `Datei: <name> (<mime>)` übergeben – der
Code kommentierte das offen als „we currently have no full-text extraction“.
Damit konnte keine Antwort etwas über den Inhalt sagen; die
Leistungszusammenfassung wiederholte im Wesentlichen Dateinamen. Seit AP-25
baut `AiAssistService.loadDocumentContents()` (API) bzw. die gleichnamige
Methode im Worker den Eingabetext je Dokument:

| `storageType` | Eingabe für den Provider |
|---|---|
| `PAPERLESS_LINK` | Paperless-OCR-Text des verknüpften Dokuments (`getDocumentContent(paperlessId)`) mit Kopfzeile `Datei: …` |
| `INTERNAL` | weiterhin nur die Kopfzeile `Datei: …` |

Die OCR-Methode existiert auf beiden Seiten (`paperless-ngx.service.ts` im API,
`paperless-tag.client.ts` im Worker) mit identischem Vertrag: `null`, wenn
Paperless deaktiviert/unerreichbar ist oder keinen verwendbaren Text liefert.
Auf eine `fields=content`-Projektion wird bewusst verzichtet, weil ältere
Paperless-Server (Legacy-Dialekt) sie ablehnen und eine abgelehnte Projektion
wie „dieses Dokument hat keinen Text“ aussehen würde.

**Bekannte Grenze:** Für `INTERNAL`-Uploads (PDF/Bild) gibt es weiterhin keine
Textextraktion – es ist keine PDF-/OCR-Bibliothek im Projekt gebunden. Solche
Dokumente tragen nur ihre Metadaten bei; eine Antwort kann sie deshalb nicht
inhaltlich beschreiben. Das ist eine dokumentierte Grenze und keine stille
Verschlechterung. Folgearbeit: Textextraktion (z. B. `pdf-parse` oder
`unpdf`) inklusive Qualitätsprüfung an einer Stichprobe.

### Sicherheitsregeln
- Prompts und Antworten protokollierbar, aber sensible Inhalte konfigurierbar maskiert.
- Provider sind global deaktivierbar.
- Pro Haushalt optional abschaltbar.

### Capability-Freigabe (AP-24)
`GET /households/:id/ai/status` liefert `{ connected, provider, reason, capable }`.
`capable` ist die Freigabe, auf der die Oberfläche ihre KI-Aktionen aufhängt
(Kosten-Seitenleiste, optionale Vertragsdokumente): `true` nur, wenn
`AI_ENABLED` gesetzt **und** der Provider antwortet. Bei deaktivierter KI
liefert der Endpunkt `{ connected: false, provider: 'none', reason: 'disabled',
capable: false }`. Die Prüfung ist damit serverseitig; das Frontend
übernimmt den Wert nur zur Anzeige.

### Ausgabeformat der KI (AP-24 §3.2, §4.2)

**Entscheidung: Variante A** – beide KI-Antworten sind versionierte
JSON-Objekte nach festem Schema, keine Markdown-Texte.

Begründung (längst in `packages/foundation/src/ai/coverage-summary-format.ts`
dokumentiert): VersiGo speichert Zusammenfassungen und zeigt sie später erneut
an. Ein strukturiertes Dokument lässt sich ohne Rateroutine neu rendern;
Markdown-als-HTML ist die klassische XSS-Falle, und fehlende bzw. unsichere
Angaben sind als Daten (`hints`, `unclearFields`) ausdrückbar, statt von der
Formatierungsdisziplin des Modells abzuhängen. Beide Formate teilen die
gleichen Regeln: versionierter Prompt, strikte serverseitige Validierung und
**ein** begrenzter Wiederholungsversuch mit präzisem Repair-Hint, danach ein
sauberer Fehlerfall – niemals stilles „Ausbessern" einer Off-Schema-Antwort.

**Zusammenfassung (`COVERAGE_SUMMARY_SCHEMA_VERSION = 2`)**

```json
{ "version": 2,
  "sections": [{ "title": "Versicherungsschutz", "items": ["…"], "note": null }],
  "hints": ["…"] }
```

Grenzen: max. 8 Abschnitte, 12 Punkte je Abschnitt, 6 Hinweise, Titel ≤ 80,
Punkt ≤ 300 Zeichen sowie (ab Version 2, AP-25) **2000 Zeichen für die gesamte
Zusammenfassung**. Verstöße (oder Antworten außerhalb des Schemas) kosten
einen Retry, dann `AI_SUMMARY_INVALID_FORMAT`.
Speicherung: `AiCoverageSummary.summaryJson`; `summaryMarkdown` bleibt die
reine Textdarstellung für Altverbraucher. Zeilen vor AP-24 haben
`summaryJson = null` und werden aus `summaryMarkdown` gerendert (keine
Datenmigration).

AP-25 (Version 2) verlangt im Prompt zusätzlich eine inhaltliche Beschreibung
(**was** versichert ist: Personen/Sachen, Leistungsumfang, Ausschlüsse,
Selbstbehalte) statt reiner Zahlenstichpunkte. Damit das überhaupt möglich
ist, muss der Provider echte Dokumentinhalte sehen (siehe «Dokumentinhalte der
KI-Aufrufe»). Das Gesamtlimit wird für jede **neu erzeugte** Antwort
durchgesetzt; nur bereits gespeicherte Zeilen einer älteren Formatversion
bleiben beim erneuten Lesen davon ausgenommen
(`allowLegacyTotalLength`, sonst würden sie auf das Legacy-Rendering
zurückfallen).

**Rendering:** eigener React-Renderer für das JSON, für Alt-Texte ein
eingeschränkter Blockparser (`# `, `## `, `- `, Absatz). Es gibt
**keine** `react-markdown`-Abhängigkeit, kein `dangerouslySetInnerHTML` und
keine HTML-Ausführung – Modell-Ausgabe kann damit keinen Skriptcode
ausführen.

**Kostenextraktion (`COST_EXTRACTION_SCHEMA_VERSION = 1`)**

```json
{ "version": 1, "amount": 123.45, "currency": "EUR", "isCredit": false,
  "invoiceDate": "2026-01-15", "validFrom": "2026-01-01", "validTo": null,
  "frequency": "ANNUAL", "bookingSource": "…", "description": "…",
  "confidence": "medium", "unclearFields": ["validTo"], "notes": null }
```

- `amount` ist numerisch, immer `>= 0`; Gutschrüfte/Erstattungen werden über
  `isCredit: true` abgebildet (der Kosteneintrag speichert positive Beträge).
- `unclearFields` darf nur die in `COST_EXTRACTION_FIELDS` definierten
  Namen enthalten; jedes genannte Feld wird im Vorschlag auf `null` gesetzt –
  nicht erkannte Felder bleiben also leer, statt geraten zu werden.
- Ein Dokument mit mehreren Positionen liefert **einen** Vorschlag, weitere
  erkannte Positionen stehen in `notes`.
- Fassadengrenze: max. 200 Zeichen Freitext. Zwei Off-Schema-Antworten
  hintereinander → `AI_COST_EXTRACTION_INVALID_FORMAT`.
- Beide System-Prompts erklären Dokumentinhalt ausdrücklich als **Daten,
  nie als Anweisung** (Prompt-Injection-Containment) und verlangen reines
  JSON ohne Markdown und ohne Code-Block.

**Bekannte Einschränkung:** Die in der Abschlusslieferung geforderte manuelle
Qualitätsbewertung des Kostenextraktions-Prompts an einer anonymisierten
Stichprobe von Abrechnungsdokumenten wurde **nicht** durchgeführt (kein
zugewiesener Prüfumfang, keine Stichprobe). Die Prompt-Texte selbst sind
dagegen in `coverage-summary-format.ts` / `cost-extraction-format.ts`
versioniert und kommentiert.

### Datenübermittlungshinweis (AP-24, erweitert in AP-25)
Vor dem ersten KI-Aufruf je Aktion bestätigt die Oberfläche den
Datenübermittlungshinweis (`ai.dataTransferNotice`/`…Confirm`/`…Required`).
Dieselben Schlüssel bedienen sowohl die Leistungszusammenfassung als auch der
Kosten-Vorschlag – es gibt genau einen Hinweistext.

AP-25 ergänzt eine **zentrale Zustimmung**: Die neue Nutzerpräferenz
`ai:dataTransferConsent` (`boolean`, Katalog in
`user-preferences.service.ts`, keine Migration nötig) merkt sich die
Bestätigung serverseitig pro Benutzer. Ist sie `true`, wird der Warnhinweis in
allen KI-Ansichten nicht mehr angezeigt; der Schalter liegt in `/settings`
unter «KI-Datenübermittlung». Voreinstellung ist „nicht erteilt“ – der
Hinweis erscheint also weiterhin, bis der Benutzer aktiv zustimmt. Ein
fehlgeschlagener Schreibvorgang blockiert die KI-Aktion nicht, der Hinweis
erscheint dann beim nächsten Aufruf erneut.

**Abgrenzung:** Die Zustimmung in der KI-Ansicht selbst (Checkbox je Aktion)
bleibt bewusst **pro Aktion** und wird nicht gespeichert – sonst würde eine
Bestätigung „für diesen Aufruf“ unbemerkt zu einer dauerhaften Einwilligung.
Nur die Profil-Option ist dauerhaft; ist sie gesetzt, gilt die Aktion in der
KI-Ansicht als bestätigt (Checkbox vorbelegt), bleibt aber einzeln
abwählbar.

**Rollen:** Die Präferenz liegt unter derselben AP-17-Regel wie alle anderen
Profilwerte (`@Roles(GlobalRole.USER)` am `UserPreferencesController`), also
dürfen nur USER und ADMIN sie lesen und schreiben; READ_ONLY erhält `403`.
Das ist konsistent, weil READ_ONLY auch keine KI-Aktion ausführen darf
(`summarize` und `cost-suggestion` sind `@Roles(USER, ADMIN)`), es gibt für
diese Rolle also nichts dauerhaft zu bestätigen. Der zusätzliche
GET auf die Präferenz, den der Hook in den KI-Ansichten auslöst, wird wie
beim Akzentfarbe-Hook (`theme-context.tsx`) bei `403`/Fehler still ignoriert –
der Hinweis bleibt dann sichtbar.

### Eingabe-Budget (AP-25)

`AI_MAX_INPUT_TOKENS` (Default `4096`, `0` = unbegrenzt) begrenzt die
Eingabelänge **eines** KI-Aufrufs. Die Zählung ist eine dokumentierte
Näherung (≈ 4 Zeichen je Token, keine Tokenizer-Abhängigkeit, weil sich
Ollama- und OpenAI-kompatible Modelle nicht gleich zählen lassen). Das Budget
wird fair über alle Dokumente eines Aufrufs verteilt; ungenutztes Budget –
auch der Rest eines gekürzten Dokuments – geht an die folgenden Dokumente
weiter. Gekürzte Dokumente tragen einen Markierungstext, und jede Kürzung wird
geloggt
(`applyInputTokenBudgetWithLog`, gemeinsam für API- und Worker-Adapter).
Es gibt damit zwei Grenzen mit unterschiedlicher Rolle:
`AI_MAX_INPUT_TOKENS` kürzt kontrolliert und der Aufruf gelingt weiter,
während `AI_SUMMARY_MAX_CHARS` (hartes Instanz-Limit) den Aufruf weiterhin
ablehnt, statt still zu kürzen.

### Neue Endpunkte (AP-24)

| Endpunkt | Zweck |
|---|---|
| `GET /households/:id/ai/status` | Capability (`capable`) für KI-Aktionen |
| `POST …/policies/:pid/summarize` | Leistungszusammenfassung; Body mit optionalem `documentIds[]` (max. 8, nur `CONTRACT`, geprüfter Lesezugriff), `acceptPartial`; Antwort `{ format: 'json', summary, summaryMarkdown, model, sourceDocuments, skippedDocuments }` |
| `GET …/policies/:pid/summary` | gespeicherte Zusammenfassung inkl. `format` |
| `POST …/policies/:pid/documents/:docId/cost-suggestion` | Kosten-**Vorschlag** für ein `BILLING`-Dokument; antwortet nie mit einem gespeicherten Eintrag |
| `GET …/policies/:pid/costs/billing-documents` | `BILLING`-Dokumente der Versicherung inkl. `usedByCostEntries` zur Markierung bereits verwendeter Dokumente (`cost-tracking`) |
| `POST …/policies/:pid/documents/classify` | Dokumentklassifikation (siehe Paperless/Abschnitt §2) |

Grenzen und Fehler der Zusammenfassung: max. 8 Dokumente
(`AI_SUMMARY_MAX_DOCUMENTS`) und max. 20 000 Zeichen Gesamt-Payload
(`AI_SUMMARY_MAX_CHARS`). Wird die Dokumentgrenze überschritten, ist das ein
sichtbarer Fehler (`TOO_MANY_DOCUMENTS`), keine stille Kürzung; zu große
Payloads → `DOCUMENT_PAYLOAD_TOO_LARGE`. Unlesbare Dokumente werden namentlich
genannt und nur über `acceptPartial: true` übersprungen (`EXCLUDED_FROM_AI`,
`EMPTY_FILE_NAME`, `UNSUPPORTED_TYPE`, sonst `UNUSABLE_DOCUMENTS`).
`sourceDocumentRefs` setzt der Server selbst, nie das Frontend.
Ein `POST …/costs` mit `sourceDocumentId` prüft serverseitig, dass das
Dokument existiert, nicht archiviert ist, zur Versicherung gehört und die
Klasse `BILLING` hat – andernfalls `400`.

## Paperless-ngx
Mögliche Modi:
- Nur Deep-Link zu Dokumenten
- Metadaten-Synchronisation
- Referenzierte Anzeige im Policy-Kontext
- Optionaler Importvorschlag anhand Tags/ASN/Document Type

### Umsetzungsstand (AP-22 – tag-basierte Dokumentzuordnung)
- **Konfiguration je Versicherung:** `PolicyPaperlessTag` (1:1 zur Versicherung)
  speichert die externe `paperlessTagId` als stabile Referenz, den Anzeigenamen
  als Cache, eine `configVersion` (Stale-Schutz), `lastSyncedAt`, `syncStatus`
  und einen nicht sensitiven `syncErrorCode`. `connectionRef` hält die zum
  Konfigurationszeitpunkt verwendete, effektive `PAPERLESS_URL` (ohne
  Zugangsdaten).
- **REST-API:** `GET /households/:id/paperless-tags` (serverseitige Suche in
  Paperless), `POST /households/:id/paperless-tags` (Tag anlegen, idempotent),
  `GET|PUT|DELETE /households/:id/policies/:id/paperless-tag` (lesen, setzen/
  wechseln, entfernen), `GET .../paperless-tag/status`,
  `POST .../paperless-tag/sync` (Sofortabgleich),
  `POST .../paperless-tag/retry` (fehlgeschlagene Tag-Zuweisung wiederholen).
  Lesende Rollen dürfen den Zustand sehen, Änderungen sind `USER`/`ADMIN`.
- **Fehlervertrag der interaktiven Tag-Endpunkte:** `GET`/`POST
  /households/:id/paperless-tags` nennen den Fehlergrund explizit, statt ein
  leeres Ergebnis („kein Treffer“) vorzutäuschen. Jede Fehlerantwort enthält
  eines dieser stabilen Präfixe im `message`-Feld:
  - `PAPERLESS_NOT_CONFIGURED` → `503` – Paperless ist deaktiviert oder die
    Basis-URL fehlt.
  - `PAPERLESS_AUTH_FAILED` → `502` – der Token ist ungültig oder hat zu wenig
    Rechte.
  - `PAPERLESS_UNREACHABLE` → `503` – Paperless antwortet nicht oder liefert
    eine unbrauchbare Antwort.
  - `PAPERLESS_TAG_SEARCH_FAILED` → `502` – die Suche wurde abgelehnt
    (`GET`).
  - `PAPERLESS_TAG_CREATE_FAILED` → `502` – das Anlegen wurde abgelehnt
    (`POST`; Text unverändert aus Kompatibilitätsgründen).
  Ein erfolgreicher Lauf ohne Treffer bleibt `200` mit leerer `items`-Liste
  (`{ items: [], page, pageCount }`).
  Die Web-Oberfläche übersetzt diese Präfixe in eine konkrete Meldung
  (`apps/web/src/lib/paperless-tag-error.ts`).
  Auch `PUT /households/:id/policies/:id/paperless-tag` folgt diesem Vertrag:
  `PAPERLESS_NOT_CONFIGURED` → `502`, `PAPERLESS_TAG_NOT_FOUND` → `404` (der
  gewählte Tag existiert in Paperless nicht) und
  `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>` → `502` mit dem eingebetteten
  Adapter-Grund (`AUTH_FAILED` | `UNREACHABLE`). `DELETE .../paperless-tag` ist
  idempotent: existiert keine Konfiguration, antwortet es `200` mit
  `{ tagRemoved: false }`. `POST .../sync` und `POST .../retry` melden
  `NO_PAPERLESS_TAG_CONFIGURED` → `404`, wenn keine Tag-Konfiguration existiert.
  **Bewusste Grenze:** Eine Ablehnung durch Paperless, die keinem der
  genannten Gründe entspricht (`REJECTED`), wird weiterhin als
  `PAPERLESS_TAG_SEARCH_FAILED` bzw. `PAPERLESS_TAG_CREATE_FAILED` mit
  unverändertem Text gemeldet – bewusst ohne rohen Upstream-Text
  durchzureichen und ohne den bestehenden Code zu brechen.
- **Outbox + Worker:** Die Änderung und die dauerhafte Job-Zeile
  (`paperless_tag_jobs`) entstehen in **einer** Transaktion; danach wird der
  Job in die Queue `paperless-tag-sync` eingereiht. Ein fehlgeschlagener
  Enqueue bleibt `PENDING` und wird vom periodischen Abgleich (`reconcile`)
  erneut zugestellt. Der Worker führt `sync-policy`, `tag-document` und
  `reconcile` aus.
- **Stale-Schutz:** Jeder Job trägt die `configVersion`. Wird der Tag geändert
  oder entfernt, werden offene Jobs als `SKIPPED` verworfen und können die
  neue Konfiguration nicht überschreiben. Zeigt `PAPERLESS_URL` auf einen
  anderen Server als `connectionRef`, werden Jobs als `CONNECTION_CHANGED`
  beendet und die Zuordnungen bleiben unangetastet (kein stilles Verschieben
  auf einen fremden Server).
- **Abgleich-Semantik:** Der Tag-Abgleich führt nur nach einem vollständig
  erfolgreichen Seitenlauf Änderungen aus. Ein unerreichbares Paperless oder
  eine fehlgeschlagene Seite führt zu einem Retry (bounded, über die outbox)
  und entfernt **nie** bestehende Zuordnungen. Verliert ein manuell
  verknüpftes Dokument den Tag, entfällt nur die automatische Herkunft
  (`linkOriginTag`); rein automatisch zugeordnete Dokumente werden archiviert,
  nicht gelöscht.
- **Manuelle Verknüpfungen:** Das bestehende Verlinken (BugFix-07) bleibt
  unverändert nutzbar und setzt zusätzlich `linkOriginManual`. Ist ein Tag
  konfiguriert, wird der Tag additiv auf dem Dokument ergänzt und sein Erfolg
  durch erneutes Lesen in Paperless bestätigt (`taggingStatus`
  `PENDING`/`APPLIED`/`FAILED`, inkl. `taggingErrorCode`).
- **Bewusste Grenzen:** Es wird ausschließlich der Tag additiv gesetzt; keine
  Dokumentdateien werden übertragen oder verändert, keine Tags oder Dokumente
  in Paperless gelöscht. Der Abgleich erfolgt pollend
  (`PAPERLESS_TAG_SYNC_INTERVAL_MS`, Default 5 Minuten), es gibt keine
  Paperless-Webhooks.
- **Abgleich konfigurierbar (AP-24 §1.2):** `PAPERLESS_TAG_SYNC_ENABLED`
  (Default `true`) schaltet den automatischen Hintergrundabgleich ab; laufende
  Jobs laufen zu Ende, manuelle Abgleiche bleiben möglich. Beide Einstellungen
  sind in `/admin/settings` änderbar und wirken ohne Neustart – der
  Abgleich-Tick liest sie bei jedem Tick neu. Bereits nach dem letzten
  erfolgreichen Abgleich ermittelte Startzeiten werden neu berechnet, damit
  sich eine Intervalländerung sofort auswirkt.
- **Staffelung:** Werden mehrere Versicherungen im selben Zeitfenster fällig,
  erhält jede Policy einen festen, aus ihrer ID berechneten Versatz (max.
  zwei Abgleich-Ticks), damit die Läufe nicht alle gleichzeitig starten. In
  der Policendetailansicht werden letzter erfolgreicher und nächster geplanter
  Abgleich angezeigt.
- **Benötigte Paperless-Rechte:** Der verwendete API-Token muss
  (a) Tags **lesen** (`GET /api/tags/`), (b) Tags **anlegen** (`POST /api/tags/`)
  – nur nötig, wenn der Nutzer einen neuen Tag erzeugt, (c) Dokumente **lesen**
  (`GET /api/documents/`) und (d) Dokumente **ändern** (`POST /api/bulk_edit/`
  bzw. `PATCH /api/documents/:id/`), um den Tag zu ergänzen. Ein Token ohne
  Änderungsrecht funktioniert für die reine Anzeige, manuell verknüpfte
  Dokumente bleiben dann im Zustand `FAILED` (erneut ausführbar über
  „Tag-Zuweisung wiederholen“).
- **Unterstützte Paperless-Versionen:** Die REST-Endpunkte
  `/api/tags/`, `/api/documents/` und `/api/bulk_edit/` sind seit
  Paperless-ngx **1.7** stabil und in den 2.x-Releases unverändert. Der
  additive Bulk-Edit ist der bevorzugte Weg; antwortet die Instanz mit
  `404`/`405`, fällt der Adapter auf ein lesend-verschmelzendes
  `PATCH /api/documents/:id/` zurück. Getestet wird gegen die minimale
  unterstützte Version **2.0** (ältere Versionen sind nicht Teil der
  Support-Matrix).
- **Archivierte Versicherungen:** Wird eine Versicherung archiviert, sind
  zugehörige Job-Zeilen veraltet; der Worker verwirft laufende/pending Jobs
  (`POLICY_ARCHIVED`), der periodische Abgleich überspringt archivierte
  Policen. Beim harten Löschen entfernt der Fremdschlüssel
  (`ON DELETE CASCADE`) Konfiguration und Job-Zeilen.
- **Kein Live-Abruf der Dokumentliste (BugFix-21):** Der Deep-Link wird im
  Adapter ausschließlich lokal aus der effektiven `PAPERLESS_URL` berechnet
  (`PaperlessNgxService.getDeepLink` ruft Paperless **nicht** auf). Zuvor las
  die Dokumentliste pro verknüpftem Dokument `GET /api/documents/:id/` – das
  Öffnen einer Versicherung erzeugte damit N Paperless-Anfragen. Preis dieser
  Änderung: der Link wird auch für ein in Paperless gelöschtes Dokument
  angezeigt (er führt dann ins Leere).
- **Metadaten aus dem Abgleich (BugFix-21):** Der Tag-Abgleich liest
  `id, title, created, mime_type` (`PaperlessTagClient.listDocumentsByTag`);
  lehnt eine Instanz diese Feldliste ab, fällt der Aufruf auf `id, title`
  zurück, damit der Sync nicht scheitert. Automatisch über den Tag zugeordnete
  Dokumente werden bei jedem Sync aktualisiert (Titel, `documentDate`,
  `mimeType`); manuell verknüpfte Dokumente werden nur **lückenhaft ergänzt**
  (vorhandene Werte werden nie überschrieben). Zusätzlich speichert die
  manuelle Verknüpfung den MIME-Typ (`documents.service.ts`).
  **Bekannte Grenze:** Für Dokumente, die vor BugFix-21 automatisch zugeordnet
  wurden, fehlen Datum und MIME-Typ, bis der erste erfolgreiche Abgleich
  gelaufen ist.
- **Anzeige in der Dokumentliste (BugFix-22):** Pro Dokument zeigt die UI den
  Dokumenttyp als Symbol (PDF/Bild/Dokument/Tabelle/sonstiges,
  `apps/web/src/lib/document-type.ts`), das Dokumentdatum in eigener Zeile
  (Grundschriftgröße), die Herkunft als Icon mit zugänglichem Namen/Tooltip
  (`auto`/`manuell`/`beides`) und – bei verknüpften Dokumenten – einen
  „In Paperless öffnen“-Button, der nur das Ziel der URL verwendet (die
  vollständige Paperless-URL wird nicht mehr als Text dargestellt). Die Liste
  ist sortierbar (Datum absteigend/aufsteigend, Name A–Z/Z–A); Dokumente ohne
  Datum stehen immer am Ende. Der Upload-Zeitstempel wird nicht mehr
  angezeigt; die Bezeichnung „Paperless-Dokument“ erscheint nur noch einmal pro
  Zeile.
  Beim manuellen Verknüpfen werden noch fehlende Metadaten (`mimeType`,
  `documentDate`) eines bereits vorhandenen Eintrags ergänzt; vorhandene Werte
  werden nie überschrieben.
  **Bewusste Grenze:** Für automatisch über den Tag zugeordnete Dokumente
  bestimmt Paperless die Metadaten (Titel, Datum, MIME-Typ). Werden sie über die
  API (`PATCH …/documents/:id`, z. B. Umbenennen) geändert, überschreibt der
  nächste Abgleich diese Änderung wieder. Eine manuelle Verknüpfung
  (`linkOriginManual`) ist davon nicht betroffen.

### Umsetzungsstand (AP-24 – Fortschritt, Intervall, Dokumentklassen)

**§1.1 Fortschritt des manuellen Abgleichs**

`POST .../paperless-tag/sync` startet den Abgleich im Worker und liefert
sofort die Job-ID zurück (kein blockinger Langabruf).
`GET .../paperless-tag/status` ergänzt die bestehende Statusabfrage um:

- `jobStatus`: `QUEUED | RUNNING | SUCCEEDED | FAILED` des letzten
  `SYNC_POLICY`-Laufs (separate `kind`-Filterung, damit die
  Tag-Zuweisungs-Jobs manueller Dokumente die Anzeige nicht verfälschen)
- `progress`: `{ jobId, status, processed, total, added, removed,
  unchanged, errorCode, createdAt, completedAt }`. `total` ist `null`, solange
  die Gesamtzahl unbekannt ist – die UI zeigt dann einen **unbestimmten**
  Balken mit dem Zwischenstand und erfindet keinen Prozentwert.
- `errorCode` wird serverseitig auf `[A-Za-z0-9_]`, max. 48 Zeichen,
  begrenzt (`sanitizeErrorCode`) – ein unerwarteter Wert kann so nie eine
  URL, einen Hostnamen oder ein Credential an alle Haushaltsmitglieder
  zurückspiegeln.

Das Frontend pollt während eines Laufs (1 s) und bricht bei Abschluss, Fehler
oder Navigation ab; bei Erfolg werden nur die betroffenen Daten neu geladen
(kein Browser-Reload). Ein zweiter Start pro Versicherung wird unterdrückt
(`alreadyRunning`), der laufende Job wird stattdessen angezeigt; der
Fortschritt ist nach einem Seiten-Reload wieder aufnehmbar. Statuswechsel
stehen in einer `aria-live`-Region.

**§1.2 Konfigurierbares Abgleichintervall**

Zwei Einstellungen im bestehenden Settings-Mechanismus (Details und gültige
Werte in `docs/13-settings-catalog.md`): `PAPERLESS_TAG_SYNC_ENABLED`
(Default `true`) und `PAPERLESS_TAG_SYNC_INTERVAL_MS` (Default `300000`).
Die UI bietet Presets von 5 Minuten bis 24 Stunden an; ein freier Wert wird
zwischen 60 s und 24 h validiert. Beides wirkt ohne Neustart.

- Deaktiviert: **keine neuen** automatischen Abgleiche. Bereits in der
  durable Outbox stehende `PENDING`-Zeilen werden weiter abgearbeitet und
  laufende Läufe laufen zu Ende – nur nichts Neues startet. Manuelle
  Abgleiche bleiben möglich.
- Staffelung: Deterministischer FNV-1a-Offset je `policyId`, gedeckelt auf
  `min(interval, 120 s)`, wird zum Intervall **addiert** (nie subtrahiert),
  damit bei vielen Versicherungen nicht alles auf den Sekundentakt
  zusammenfällt. API und Worker teilen sich die Helfer in
  `packages/foundation/src/config/paperless-sync-schedule.ts`, damit
  `nextSyncAt` (API) und die Fälligkeitsprüfung (Worker) nicht auseinander-
  laufen. Noch nie synchronisierte Versicherungen gelten als sofort fällig.

**§2 Dokumentklassifikation**

`PolicyDocument.documentClass` (enum `DocumentClass`, siehe
`docs/04-data-model.md`) ist eine **manuelle** Zuordnung je Versicherungs-
Zuordnung. Die Migration setzt bestehende Dokumente auf `UNCLASSIFIED`;
eine inhaltliche, automatische Klassifikation ist ausdrücklich nicht Teil
dieses Pakets. **Die Tag-Synchronisation schreibt das Feld nie an** – die
Klassifikation überlebt jeden Abgleich (eigener Test).

- `POST /households/:id/policies/:pid/documents/classify`
  mit `{ documentIds: string[], documentClass }`, max. 200 Ids je Aufruf
  (`MAX_BULK_CLASSIFY`), serverseitig validiert; fremde oder archivierte
  Dokumente werden abgelehnt.
- `GET .../documents?documentClass=BILLING` filtert die Liste (ein
  `documentClass`-Filter zusätzlich zu den bestehenden Filtern).
- Relevanz für andere Funktionen: `CONTRACT` speist die optionale
  Dokumentauswahl der KI-Leistungszusammenfassung (§3.1),
  `BILLING` die Kosten-Seitenleiste (§4.1).

### Umsetzungsstand (AP-25 – OCR-Inhalt und Vorschau)

- **OCR-Inhalt (`getDocumentContent`)**: `IPaperlessAdapter` und der
  Worker-Client (`paperless-tag.client.ts`) haben je eine Methode, die den von
  Paperless erkannten Text eines Dokuments liefert (`GET /documents/:id/`,
  vollständiges Dokument). Rückgabe ist `null`, wenn Paperless deaktiviert,
  unreachable oder ohne Text ist; die KI-Aufrufe behandeln das als „nur
  Metadaten". Der Inhalt ist die einzige Quelle für `PAPERLESS_LINK`-Dokumente
  (siehe «Dokumentinhalte der KI-Aufrufe»).
- **Dokumentvorschau (Bugfix)**: `PAPERLESS_LINK`-Dokumente haben keine lokale
  Datei. Bis AP-25 baute `getDocumentAndPath` trotzdem einen Pfad, `stat()`
  scheiterte mit `ENOENT` und der Client bekam einen undurchsichtigen `500`
  („Internal server error", die Voreinstellung von Nest für einen rohen
  Fehler) ohne verwertbaren Fehlercode – der absolute Pfad stand nur im
  Server-Log. Jetzt lehnt
  `GET /households/:id/policies/:pid/documents/:docId/(preview|download)`
  solche Dokumente mit `404 DOCUMENT_NOT_STORED_LOCALLY` ab; ebenso wird ein
  zwischenzeitlich gelöschtes lokales File als `404 DOCUMENT_FILE_MISSING`
  beantwortet (ein `ENOENT` im Stream-Pfad wird ebenfalls zu `404`), nicht als
  `500`.
- **Oberfläche**: Die Kosten-Seitenleiste zeigt für `PAPERLESS_LINK`-Dokumente
  keinen Vorschau-Button und keinen iframe mehr, sondern den Hinweis
  `costs.previewInPaperlessOnly` (Deep-Link bietet der Reiter „Dokumente“).

## Versicherungsportale
Technisch realistisch in Stufen:
- Stufe 1: Manuelle Deeplinks und Zugangshinweise
- Stufe 2: Anbieter-spezifische Dokument- oder Nachrichtenschnittstellen, falls vorhanden
- Stufe 3: Browser-Automation nur als experimentelles Plugin, nicht Kernsystem

### Umsetzungsstand (AP-18)
- **Portal-Katalog** (`apps/api/src/features/portal-connectors/portal-catalog.ts`):
  Versionierter Katalog (`PORTAL_CATALOG_VERSION`) mit je Anbieter `providerKey`,
  `displayName`, Deeplink-Vorlage (Vorlage ohne Platzhalter oder manuelle URL)
  und Zugangshinweis (`accessHint`). Derzeit enthaltene Anbieter:
  HUK-COBURG, HUK24, Allianz, AXA, ERGO, Generali, DEVK, Signal Iduna, VGH,
  Wüstenrot, VKB und CosmosDirekt.
- **Portal-Links und Stammdaten (BugFix-22):** Die Portal-URL wird nicht mehr
  in den Versicherung-Stammdaten geführt. Die Portal-Link-Maske ist der einzige
  Ort zur Anlage/Bearbeitung von Portal-Links. Ein vorhandener
  Legacy-Wert `insurerPortalUrl` der Versicherung wird bei Anlage eines neuen
  Portal-Links vorbelegt; er wird weder gelöscht noch automatisch in einen
  Portal-Link umgewandelt.
- **Deep-Link-Auflösung:** Reihenfolge manueller `portalUrl` > Katalog-Vorlage.
  Nur manuelle `http(s)`-URLs haben Vorrang; andere Schemata (z. B.
  `javascript:`, `data:`) und unparsbare Werte werden verworfen und fallen
  auf die Katalog-Vorlage zurück (dasselbe gilt für die Ausgabe der
  `portalUrl` – der Client erhält nie ein Nicht-`http(s)`-Link-Ziel).
  Die Katalog-Vorlage kann optional `{contractNumber}` enthalten; die
  Vertragsnummer wird dabei URL-encodiert eingesetzt. Ohne bestimmbaren
  Deeplink liefert die API `deepLinkUrl: null`, ohne den Link zu brechen.
- **Plugin-Rahmen:** `PortalConnectorPlugin`-Interface + `PortalConnectorRegistry`.
  Der Mailbox-/Dokumentenabruf ist als experimentelles, **deaktiviertes** Plugin
  (`mailbox-sync-browser-automation`) registriert. Health-Endpunkte
  (`GET /portal-connectors/plugins/:key/health`) degradieren kontrolliert
  (`available: false`) statt Fehler zu werfen.
- **REST-API:** `GET /portal-connectors/catalog`, `GET /portal-connectors/catalog/:providerKey`,
  `GET /portal-connectors/plugins`, `GET /portal-connectors/plugins/:key/health`
  – jeweils für alle authentifizierten Rollen lesbar.
- **Portal-Links pro Vertrag:** Verwaltung über das Policy-Registry-Slice
  (`PortalAccountLink`, inkl. optionalem `connectorKey`, `accessHint` und
  verschlüsselten Zugangsdaten).

## OIDC
Unterstützte Modi:
- Externer Issuer via Discovery
- OIDC ist ein zweiter Login-Weg, der an ein bestehendes lokales Konto gebunden ist (`(oidcIssuer, oidcSubject)` auf `users`, AP-16/ADR-007)
- Kein Account-/Rollen-Provisioning aus Claims: Bindung setzt ein Admin (`POST /admin/users/:id/oidc-binding`), fehlgeschlagene Logins liefern generische Fehler
