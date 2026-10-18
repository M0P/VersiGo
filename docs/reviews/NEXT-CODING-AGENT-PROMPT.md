# Next Coding Agent Prompt

**Next work package:** prompts/AP-24-detailverbesserungen

**Base branch:** feature/ap-23-mobile-tablet-ui (current HEAD: 9912c63)
**Previous completed package:** AP-23-MOBILE-TABLET-UI.md (AP-23) — insurance types added (Rentenversicherung, Krankenversicherung, Krankenversicherung (Ausland)), i18n + POLICY_TYPES updated, API DTOs accept new enum values; Prisma enum updated (migration required in target environment).

## Instructions for the next agent
You must implement ONLY the work package `prompts/AP-24-detailverbesserungen`. Do not start any later work package.

Use the same workflow:
1. Read the supplied work package completely.
2. Inspect relevant codebase, docs, tests, conventions.
3. Implement exactly what is specified.
4. Run formatter/linter/type-check/build/tests where available (Docker Compose gate is mandatory for verification; see AGENTS.md).
5. Fix failures before requesting review.
6. Invoke @code-reviewer to review uncommitted changes against the work package, conventions, correctness, regressions, security, tests, maintainability.
7. Write each review report verbatim to docs/reviews/<work-package-number>-review-<iteration>.md (create docs/reviews if missing).
8. Fix all Critical/High/Medium findings; fix Minor findings when reasonable/safe.
9. Re-run relevant checks.
10. Re-invoke @code-reviewer and repeat until: 0 Critical, 0 High, 0 Medium, ≤ 8 Minor, and relevant automated checks pass (or blocked/unavailable checks explained).
11. If 5 review rounds reached without meeting acceptance, stop without committing; report remaining findings and ask the user to decide.

When acceptance is met:
1. Check git diff/status.
2. Commit only changes belonging to this work package with message starting with the work package number (e.g. "AP-24: ...").
3. Find the next work package by selecting the next numbered Markdown file in /prompts after prompts/AP-24-detailverbesserungen.
4. Create docs/reviews/NEXT-CODING-AGENT-PROMPT.md for that next package (include filename + full content + same instructions).
5. Stop. Do NOT push, merge, or start the next package.

## Full content of prompts/AP-24-detailverbesserungen
# AP: Sammelpaket kleiner Verbesserungen

## Ziel

Dieses Arbeitspaket bündelt mehrere kleinere Verbesserungen in fünf Bereichen:

1. Paperless-ngx-Dokumentzuordnung
2. Dokumentklassifikation
3. KI-Leistungszusammenfassung
4. Kosten
5. Versicherte Personen oder Objekte

Nutze die bestehende Architektur, Komponenten, Berechtigungslogik, Queue-Infrastruktur und KI-Anbindung. Führe keine parallelen Lösungen ein. Alle Änderungen sind additiv und rückwärtskompatibel, soweit nicht ausdrücklich anders beschrieben.

Führe zuerst eine Bestandsaufnahme der betroffenen Stellen durch und dokumentiere, welche vorhandenen Strukturen erweitert werden.

---

## 1. Paperless-ngx-Dokumentzuordnung

### 1.1 Fortschrittsanzeige beim manuellen Abgleich

Wenn ein Nutzer den Abgleich manuell startet, soll der Fortschritt sichtbar sein. Nach erfolgreichem Abschluss wird der Seiteninhalt ohne vollständigen Seiten-Reload aktualisiert.

#### Anforderungen

- Beim Auslösen des Abgleichs liefert die API sofort eine Job-ID bzw. einen Statusverweis zurück; der Abgleich selbst läuft weiter im Worker.
- Ergänze einen Status-Endpunkt oder eine bestehende Status-Abfrage mit mindestens diesen Zuständen: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`.
- Der Status enthält, soweit ermittelbar: verarbeitete Seiten bzw. Dokumente, Gesamtzahl, neu zugeordnete, entfernte und unveränderte Dokumente sowie einen nicht sensitiven Fehlercode.
- Ist die Gesamtzahl unbekannt, zeige einen unbestimmten Fortschrittsbalken mit dem bereits verarbeiteten Zwischenstand. Täusche keinen exakten Prozentwert vor.
- Das Frontend fragt den Status in sinnvollen Intervallen ab (Polling) oder nutzt einen bereits vorhandenen Echtzeitmechanismus. Neue Infrastruktur ist nur bei klarem Bedarf einzuführen.
- Das Polling endet bei Abschluss, Fehler, Navigation weg von der Seite oder Abbruch durch den Nutzer.
- Bei Erfolg werden ausschließlich die betroffenen Daten neu geladen, beispielsweise per Query-Invalidierung oder Router-Refresh der Dokumentliste. Ein vollständiger Browser-Reload ist nicht zulässig.
- Scroll-Position, Filter, geöffnete Bereiche und nicht gespeicherte Eingaben bleiben erhalten.
- Bei Fehlern wird eine verständliche Meldung angezeigt; die zuletzt bekannte Dokumentliste bleibt unverändert sichtbar.
- Der Auslöser-Button ist während eines laufenden Abgleichs deaktiviert. Ein zweiter Klick oder ein zweiter Browser-Tab darf keinen parallelen Lauf für dieselbe Versicherung starten; stattdessen wird der laufende Job angezeigt.
- Der Fortschritt muss nach einem Seiten-Reload wiederaufnehmbar sein, falls ein Lauf noch aktiv ist.
- Statusänderungen werden Screenreadern angekündigt (`aria-live`), der Fortschrittsbalken ist korrekt beschriftet.
- Prüfe, dass die Status-Abfrage Haushalts- und Rollenberechtigungen berücksichtigt.

#### Akzeptanzkriterien

- Nach dem Start erscheint innerhalb kurzer Zeit ein sichtbarer Fortschritt.
- Nach Erfolg zeigt die Liste die neuen Zuordnungen ohne Seiten-Reload.
- Bei Fehler bleibt der alte Stand sichtbar und eine Wiederholung ist möglich.
- Doppelte parallele Läufe pro Versicherung sind ausgeschlossen.

### 1.2 Konfigurierbares Abgleichintervall

Der regelmäßige automatische Abgleich muss in den Einstellungen konfigurierbar sein.

#### Anforderungen

- Ergänze in den bestehenden Admin-/Systemeinstellungen einen Bereich für den automatischen Paperless-Abgleich.
- Konfigurierbar sind mindestens: automatischer Abgleich aktiv/inaktiv und das Intervall.
- Das Intervall wird über vordefinierte Auswahlwerte angeboten, beispielsweise 5, 15, 30 Minuten, 1, 6 und 24 Stunden. Ein freier Wert ist nur zulässig, wenn er validiert wird (Mindest- und Höchstwert).
- Der Standardwert bleibt fünf Minuten, wie im bestehenden Konzept, sofern keine andere Vorgabe im Projekt besteht.
- Die Einstellung wird in der Datenbank bzw. im bestehenden Einstellungsmechanismus gespeichert und serverseitig validiert.
- Änderungen wirken ohne Neustart der Anwendung. Der Scheduler liest die Konfiguration dynamisch oder wird nach einer Änderung sauber neu geplant.
- Beim Deaktivieren laufen keine neuen automatischen Abgleiche an; manuelle Abgleiche bleiben möglich.
- Bereits laufende Jobs werden nicht abgebrochen.
- Verteile Abgleiche mehrerer Versicherungen gestaffelt, damit nicht alle gleichzeitig starten.
- Zeige in der Oberfläche den Zeitpunkt des letzten erfolgreichen und optional des nächsten geplanten Abgleichs.
- Änderungen an der Einstellung werden im Audit-Log erfasst.
- Nur berechtigte Rollen dürfen die Einstellung ändern.

#### Akzeptanzkriterien

- Intervall und Aktivierung sind in der Oberfläche änderbar.
- Ungültige Werte werden abgelehnt.
- Der Scheduler verwendet nach Speicherung den neuen Wert ohne Neustart.
- Die Anzeige von letztem Abgleich und Status ist korrekt.

---

## 2. Dokumente klassifizieren

Dokumente sollen einer Klasse zugeordnet werden können.

### 2.1 Dokumentklassen

Lege eine typisierte, serverseitig validierte Klassenliste an. Vorschlag:

| Schlüssel | Anzeigename | Beschreibung |
|---|---|---|
| `CONTRACT` | Vertragsdokument | Police, Antrag, Nachträge, Vertragsbedingungen, Bestätigungen |
| `BILLING` | Abrechnung | Beitragsrechnung, Beitragsabrechnung, Jahresabrechnung, Leistungs- oder Erstattungsabrechnung |
| `CORRESPONDENCE` | Korrespondenz | Briefe, E-Mails, Mitteilungen des Versicherers |
| `CLAIM` | Schaden/Leistungsfall | Schadensmeldung, Gutachten, Leistungsentscheidung |
| `OTHER` | Sonstiges | Alles andere |
| `UNCLASSIFIED` | Nicht klassifiziert | Standard für neue und bestehende Dokumente |

Hinweise:

- Die Klassen `CONTRACT` und `BILLING` sind verbindlich; die weiteren Klassen sind Vorschläge und können nach Rücksprache angepasst werden.
- Verwende stabile technische Schlüssel (Enum oder Referenztabelle). Anzeigenamen werden über das vorhandene Übersetzungsverfahren gepflegt.
- Falls Erweiterbarkeit durch Administratoren gefordert wird, ist dies in einem Folgepaket zu behandeln. Für dieses AP genügt eine feste Liste.

### 2.2 Datenmodell und Migration

- Ergänze die Dokumentverknüpfung um das Feld `documentClass` mit Standardwert `UNCLASSIFIED`.
- Bestehende Dokumente werden bei der Migration als `UNCLASSIFIED` übernommen. Es erfolgt keine automatische inhaltliche Klassifikation durch die Migration.
- Für Paperless-Dokumente wird die Klasse in Insura an der Dokumentzuordnung gespeichert. Die Klassifikation darf Paperless-Dokumente nicht verändern.
- Klasse und Zuordnung müssen auch bei automatischer Tag-Zuordnung persistent bleiben. Ein Abgleich überschreibt eine bestehende Klassifikation nicht.
- Sieht das Datenmodell mehrfache Zuordnung desselben externen Dokuments zu mehreren Versicherungen vor, ist festzulegen und zu dokumentieren, ob die Klasse je Zuordnung oder je Dokument gilt. Bevorzugt wird die Klasse je Versicherungszuordnung.
- Erstelle eine additive Prisma-Migration.

### 2.3 Oberfläche und Backend

- Die Klasse ist in der Dokumentliste sichtbar, beispielsweise als Badge.
- Die Klasse lässt sich beim Hinzufügen, beim manuellen Verlinken und nachträglich in den Dokumentdetails ändern.
- Zusätzlich gibt es eine Mehrfachauswahl zum Ändern der Klasse mehrerer Dokumente.
- Die Dokumentliste ist nach Klasse filterbar.
- Die Änderung wird serverseitig mit den bestehenden Berechtigungen geprüft und im Audit-Log erfasst.
- Eine fehlende oder ungültige Klasse führt zu einem validierten Fehler.
- Die Klassifikation ist auch auf Smartphone und Tablet gut bedienbar.

### Akzeptanzkriterien

- Neue und bestehende Dokumente haben standardmäßig die Klasse „Nicht klassifiziert“.
- Klassen können einzeln und in Mehrfachauswahl geändert werden.
- Die Klasse bleibt nach Paperless-Abgleichen erhalten.
- Die Liste ist nach Klasse filterbar.

---

## 3. KI-Leistungszusammenfassung

### 3.1 Optionale Nutzung von Vertragsdokumenten

Die KI-Leistungszusammenfassung kann optional auf einem oder mehreren als `CONTRACT` klassifizierten Dokumenten basieren.

#### Anforderungen

- Die Auswahl ist optional. Ohne Auswahl bleibt das bisherige Verhalten erhalten.
- Der Nutzer kann alle oder einzelne Vertragsdokumente der Versicherung auswählen.
- Zur Auswahl stehen nur Dokumente der Klasse `CONTRACT`, für die der Nutzer berechtigt ist.
- Vor der Übergabe an die KI zeigt die Oberfläche eine klare Hinweismeldung, dass Dokumentinhalte an den konfigurierten KI-Anbieter übermittelt werden. Beachte bestehende Datenschutzeinstellungen und Freigabemechanismen.
- Die Textextraktion nutzt vorhandene Mechanismen. Bei Paperless-Dokumenten ist zu prüfen, ob bereits extrahierter Inhalt verwendet werden kann; andernfalls ist die vorhandene Dokumentverarbeitung wiederzuverwenden.
- Begrenze Anzahl und Größe der Dokumente anhand des Kontextfensters und der konfigurierten Limits. Bei Überschreitung wird der Nutzer informiert, statt Inhalte stillschweigend abzuschneiden.
- Nicht lesbare, leere oder nicht unterstützte Dokumente werden benannt und gesondert behandelt; die Zusammenfassung wird nur mit den verwertbaren Dokumenten erstellt, wenn der Nutzer dies bestätigt oder der Ablauf dies eindeutig ausweist.
- Die Antwort enthält Informationen zu den verwendeten Quellen, beispielsweise Dokumentnamen, soweit dies fachlich sinnvoll ist.
- Dokumentinhalte werden nicht dauerhaft in zusätzlichen Insura-Tabellen gespeichert, sofern dies nicht bereits Bestandteil der Architektur ist.
- Dokumentinhalte und Zusammenfassungen werden nicht ungeschützt geloggt.
- Der Prompt muss Dokumentinhalt klar als Daten und nicht als Anweisungen behandeln, um Prompt-Injection über Dokumenttext zu begrenzen.
- Die Zusammenfassung ist als KI-generiert zu kennzeichnen. Rechtliche oder vertragliche Aussagen sind kein Ersatz für die Originaldokumente.
- Wenn keine KI-Funktion aktiviert oder eingerichtet ist, ist die Option nicht sichtbar.
- Kostentracking oder Nutzungsprotokolle der KI-Funktion werden wie bei bestehenden KI-Aufrufen fortgeführt.

### 3.2 Einheitliches Ausgabeformat

Die KI gibt Antworten derzeit teilweise als Markdown zurück. Das Format muss einheitlich definiert und in der Oberfläche korrekt dargestellt werden.

#### Entscheidung

Definiere ein verbindliches Ausgabeformat und dokumentiere es zusammen mit dem Prompt. Zwei Varianten sind zulässig; wähle eine nach Prüfung der bestehenden KI-Anbindung und begründe sie:

- **Variante A (bevorzugt für strukturierte Inhalte):** Die KI liefert ein JSON-Objekt nach festem Schema (zum Beispiel Abschnitte, Listen, Hinweise). Die Oberfläche rendert daraus selbst. Für eine zuverlässige Verarbeitung ist schemaerzwungene Ausgabe oder Function Calling bevorzugt; reines Prompt-JSON eignet sich eher für Prototypen. [web:43]
- **Variante B:** Die KI liefert Markdown in einer klar eingeschränkten Teilmenge (Überschriften, Absätze, Listen, Fettdruck, Tabellen). Markdown wird immer erwartet und immer gerendert; Mischformen sind nicht zulässig.

Unabhängig von der Variante gilt:

- Das Schema bzw. die erlaubte Markdown-Teilmenge wird zentral definiert.
- Die Ausgabe wird serverseitig validiert; bei Verstoß erfolgt ein begrenzter Wiederholungsversuch mit präzisiertem Prompt und danach ein sauberer Fehlerfall. [web:48]
- Die Anzahl der Wiederholungen ist begrenzt.
- Ungültige Rohausgaben werden zu Diagnosezwecken ohne vertrauliche Dokumentinhalte protokolliert, soweit dies datenschutzkonform möglich ist.
- Bestehende bereits gespeicherte Zusammenfassungen müssen weiterhin dargestellt werden. Alte unstrukturierte oder Markdown-Texte werden beim Anzeigen kompatibel behandelt; eine Datenmigration ist nur bei Bedarf vorzusehen.

#### Darstellung

- Die Oberfläche rendert die Zusammenfassung formatiert und konsistent.
- Wird Markdown verwendet, ist ein sicherer Renderer einzusetzen. `react-markdown` erzeugt React-Elemente statt HTML-Strings und schützt dadurch standardmäßig besser vor XSS; rohes HTML wird nicht aktiviert. [web:42][web:44]
- Falls zusätzliches HTML gerendert werden muss, ist `rehype-sanitize` mit Allowlist zwingend. [web:42][web:49]
- Unsichere Link- und Bild-Schemata (`javascript:`, `data:`, `vbscript:`) sind zu blockieren. [web:49]
- Verwende keine ungesicherte Einbindung über `dangerouslySetInnerHTML`.
- Typografie, Listen, Tabellen und lange Wörter müssen auf Desktop, Tablet und Smartphone korrekt dargestellt werden.
- Das Rendering funktioniert in hellem und dunklem Modus, sofern beide unterstützt werden.

### Akzeptanzkriterien

- Vertragsdokumente können optional ausgewählt werden, die Option erscheint nur bei aktivierter KI.
- Die Ausgabe folgt immer demselben definierten Format.
- Die Oberfläche stellt sie formatiert dar.
- HTML- oder Script-Inhalte in KI-Antworten werden nicht ausgeführt.
- Der Datenübermittlungshinweis ist sichtbar.
- Ohne Dokumentauswahl funktioniert die bisherige Zusammenfassung unverändert.

---

## 4. Kosten

### 4.1 Seitenleiste mit Abrechnungsdokumenten

- Die Kostenansicht zeigt eine Seitenleiste mit Dokumenten der Versicherung, die als `BILLING` klassifiziert sind.
- Jeder Eintrag zeigt mindestens Titel, Datum und Herkunft; bereits für einen Kosteneintrag verwendete Dokumente werden sichtbar markiert.
- Aus der Seitenleiste lässt sich die Dokumentvorschau öffnen, ohne die Kostenansicht zu verlassen.
- Eine Suche oder ein Filter ist vorzusehen, wenn die Liste umfangreich werden kann.
- Leerer Zustand: Hinweis, dass bislang keine Dokumente als „Abrechnung“ klassifiziert sind, mit direktem Zugang zur Klassifikation.
- Auf Desktop als fest eingeblendete Seitenleiste; auf Tablet einklappbar; auf Smartphone als Bottom-Sheet, Schublade oder eigener Tab.
- Die Liste aktualisiert sich nach Klassifikationsänderungen ohne vollständigen Seiten-Reload.

### 4.2 Kosteneintrag aus Dokument per KI

- Für Abrechnungsdokumente gibt es die Aktion „Kosten per KI erfassen“.
- Die Aktion ist ausschließlich sichtbar, wenn die KI-Funktion aktiviert **und** vollständig eingerichtet ist. Die Prüfung erfolgt serverseitig und wird dem Frontend als Capability bereitgestellt.
- Die KI liefert einen **Vorschlag**, keinen automatisch gespeicherten Eintrag.
- Der Nutzer sieht die extrahierten Werte in der bestehenden Kosteneintragsmaske vorausgefüllt, kann sie ändern und bestätigt das Speichern bewusst.
- Der Kosteneintrag verweist auf das Quelldokument.
- Vor der Übermittlung gilt derselbe Datenübermittlungshinweis wie bei der Leistungszusammenfassung.

#### Extraktionsschema

Der Prompt und das serverseitig validierte Schema werden auf das bestehende Kostenmodell abgestimmt. Prüfe zuerst die vorhandenen Felder und Kategorien. Als Ausgangspunkt dienen:

| Feld | Typ | Hinweis |
|---|---|---|
| `amount` | Zahl | Numerisch, kein Währungssymbol im Wert |
| `currency` | ISO-Code | Beispielsweise EUR |
| `date` | ISO-Datum | Rechnungs- bzw. Abrechnungsdatum |
| `periodStart`, `periodEnd` | ISO-Datum oder `null` | Abgedeckter Zeitraum |
| `category` | Enum | Muss den vorhandenen Kostenkategorien entsprechen |
| `description` | String | Kurze, neutrale Beschreibung |
| `confidence` | Enum | Zum Beispiel `high`, `medium`, `low` |
| `notes` | String oder `null` | Auffälligkeiten, Unsicherheiten |

Vorgaben für die Extraktion:

- Nicht sicher bestimmbare Felder werden mit `null` zurückgegeben, nicht geraten. [web:46]
- Explizite Unsicherheitsmarker für fehlende, mehrdeutige oder widersprüchliche Angaben sind vorzusehen. [web:46]
- Zahlen sind numerisch und nicht als formatierter Text zu liefern. [web:43]
- Geschlossene Auswahlfelder werden als Enum definiert. [web:43]
- Die Ausgabe wird validiert, bei Fehlern wird begrenzt wiederholt oder an die manuelle Erfassung zurückgegeben. [web:48]
- Enthält ein Dokument mehrere Positionen oder Zeiträume, ist festzulegen, ob mehrere Vorschläge geliefert werden. Für dieses AP genügt ein Vorschlag je Dokument, mit Hinweis auf weitere erkannte Positionen in `notes`.
- Der Prompt behandelt Dokumentinhalt ausdrücklich als Daten, nicht als Anweisung.
- Der Prompt ist versioniert, dokumentiert und mit Beispielen für typische Abrechnungsdokumente abgestimmt.
- Rundungs-, Dezimaltrenner- und Datumsformate (deutsche Schreibweise, z. B. `1.234,56 €`) müssen korrekt interpretiert werden.
- Beträge mit Vorzeichen (Gutschrift, Erstattung) sind eindeutig zu behandeln und im Schema abzubilden.

#### Fehlerfälle

- Nicht lesbares Dokument, leerer Text, Zeitüberschreitung, ungültige Antwort und KI-Fehler führen zu einer verständlichen Meldung ohne Datenverlust.
- Der Nutzer kann die Kosten anschließend manuell erfassen.
- Bereits erfasste Einträge zu demselben Dokument werden angezeigt, um Doppelerfassung zu vermeiden. Ein Hinweis genügt; das erneute Erfassen bleibt möglich.

### Akzeptanzkriterien

- Die Seitenleiste zeigt ausschließlich `BILLING`-Dokumente der Versicherung.
- Die KI-Aktion ist nur bei aktivierter und eingerichteter KI sichtbar, auch serverseitig abgesichert.
- Ein Vorschlag wird nie ohne Bestätigung gespeichert.
- Nicht erkannte Felder bleiben leer.
- Der Kosteneintrag verweist auf das Quelldokument.
- Fehler beeinträchtigen die manuelle Erfassung nicht.

---

## 5. Versicherte Personen oder Objekte

### 5.1 Dynamische Feldbezeichnung

In der Eingabemaske ist die Überschrift „Personenname“ immer statisch, auch wenn ein Objekt erfasst wird.

- Die Bezeichnung richtet sich nach dem gewählten Typ.
- Bei Person: „Name der Person“ bzw. „Personenname“, entsprechend der bestehenden Terminologie.
- Bei Objekt: „Bezeichnung des Objekts“ bzw. „Objektbezeichnung“.
- Falls es weitere Typen oder Unterarten gibt, ist für jeden eine passende Bezeichnung zu definieren.
- Die Bezeichnung wechselt sofort bei Änderung des Typs, ohne bereits eingegebene Werte zu löschen.
- Platzhaltertexte, Hilfetexte, Validierungsfehler, Barrierefreiheitsbeschriftungen (`aria-label`) und Bestätigungsdialoge verwenden dieselbe typabhängige Bezeichnung.
- Überprüfe auch Listen, Detailansichten, Tabellenüberschriften und Dokumenten- oder Kostenbezüge auf einen statischen Begriff „Person“, der bei Objekten irreführend ist.
- Alle Texte werden über das bestehende Übersetzungsverfahren gepflegt.

### 5.2 Feld „Beziehung“

- Ändere die Beschriftung „Beziehung (Optional)“ in „Beziehung“.
- Das Feld bleibt technisch optional, die Optionalität wird jedoch nicht mehr explizit im Label genannt.
- Prüfe, ob dasselbe Label auch in Übersetzungen, Tests, Dokumentation und Screenshots vorkommt, und passe sie an.
- Setze keine Pflichtfeldmarkierung, wenn das Feld nicht verpflichtend ist.
- Die Bezeichnung für Objekte ist fachlich zu prüfen: Falls „Beziehung“ bei Objekten missverständlich ist, ist stattdessen ein passenderer typabhängiger Begriff zu wählen und zu dokumentieren.

### Akzeptanzkriterien

- Bei Personen und Objekten erscheint jeweils die passende Feldüberschrift.
- Das Label „Beziehung“ enthält keinen Zusatz „(Optional)“.
- Validierung, Hilfetexte und Barrierefreiheit verwenden konsistente Begriffe.

---

## Übergreifende Anforderungen

- Alle neuen Oberflächen funktionieren auf Desktop, Tablet und Smartphone.
- Lade-, Leer- und Fehlerzustände sind für alle neuen Elemente umgesetzt.
- Texte werden über das vorhandene Übersetzungssystem bereitgestellt.
- Neue Endpunkte verwenden validierte DTOs, bestehende Autorisierung und nachvollziehbare Fehlercodes.
- Zugangsdaten, Dokumentinhalte und KI-Rohantworten werden nicht ungeschützt protokolliert.
- Datenbankänderungen erfolgen ausschließlich über additive, testbare Prisma-Migrationen.
- Bestehende Funktionen und Daten bleiben unverändert nutzbar.
- Audit-Ereignisse werden für Konfigurationsänderungen, Klassifikationen und KI-gestützte Kosten- oder Zusammenfassungsaktionen ergänzt, soweit im Projekt vorgesehen.

## Tests

### Unit-Tests

- Statusmodell und Zustandsübergänge des Paperless-Abgleichs.
- Validierung der Intervalleinstellung.
- Validierung von Dokumentklassen.
- Schema-Validierung der KI-Antworten (Zusammenfassung und Kostenextraktion), einschließlich ungültiger und unvollständiger Antworten.
- Typabhängige Feldbezeichnungen.

### Integrations-Tests

- Manueller Abgleich: Start, Fortschritt, Abschluss, Fehler, Wiederaufnahme nach Reload, Verhinderung paralleler Läufe.
- Scheduler übernimmt geänderte Intervalle ohne Neustart.
- Klassifikation bleibt nach Paperless-Abgleich erhalten.
- Mehrfachklassifikation und Filterung.
- Zusammenfassung mit und ohne Dokumentauswahl; Beschränkung auf berechtigte `CONTRACT`-Dokumente.
- Kostenvorschlag aus Dokument; Ausblenden der Funktion bei deaktivierter oder unvollständig konfigurierter KI.
- Berechtigungsprüfungen für Status-, Klassifikations- und KI-Endpunkte.
- Migration erhält bestehende Dokumente und setzt `UNCLASSIFIED`.

### Frontend- und End-to-End-Tests

- Fortschrittsanzeige und Aktualisierung ohne Seiten-Reload.
- Sicheres Rendern von KI-Ausgaben, einschließlich Testfällen mit HTML, Skript-Inhalt und gefährlichen Link-Schemata.
- Seitenleiste in den Kosten auf Desktop, Tablet und Smartphone.
- Prüfung der vollständigen Kette: Dokument klassifizieren, erscheint in der Kosten-Seitenleiste, Kosten per KI vorschlagen, bestätigen, Eintrag mit Dokumentverweis gespeichert.
- Eingabemaske für Person und Objekt mit korrekten Beschriftungen.

KI-Aufrufe werden in automatisierten Tests durch kontrollierte Mocks ersetzt. Zusätzlich ist mit einer repräsentativen, anonymisierten Stichprobe an Abrechnungsdokumenten die Qualität des Extraktionsprompts manuell zu bewerten und zu dokumentieren.

## Reihenfolge der Umsetzung

1. Dokumentklassifikation (Grundlage für KI und Kosten).
2. Personen-/Objekt-Labels (unabhängig, schnell umsetzbar).
3. Paperless-Fortschritt und konfigurierbares Intervall.
4. Einheitliches KI-Ausgabeformat und sicheres Rendering.
5. Optionale Vertragsdokumente für die Leistungszusammenfassung.
6. Kosten-Seitenleiste und KI-Kostenerfassung.

## Nicht Bestandteil

- Automatische KI-Klassifikation von Dokumenten.
- Benutzerdefinierte, frei erweiterbare Dokumentklassen.
- Automatisches Speichern von KI-Vorschlägen ohne Nutzerbestätigung.
- Mehrpositions-Extraktion mit Aufteilung in mehrere Kosteneinträge.
- Neue Echtzeit-Infrastruktur, sofern Polling ausreicht.
- Änderung des KI-Anbieters oder der Authentifizierung.

## Abschlusslieferung

Liefere:

1. Implementierung in den bestehenden Projektstrukturen.
2. Additive Prisma-Migration(en).
3. Dokumentation des KI-Ausgabeformats einschließlich Schema, Prompt-Version und Rendering-Entscheidung.
4. Dokumentation des Kostenextraktions-Prompts, Beispiele und Ergebnis der manuellen Qualitätsbewertung.
5. Aktualisierte Konfigurations- und Nutzerdokumentation (insbesondere Abgleichintervall, Dokumentklassen, KI-Datenübermittlung).
6. Automatisierte Tests und deren tatsächliche Ergebnisse.
7. Liste geänderter Dateien mit kurzer Begründung.
8. Offene Punkte und Einschränkungen, klar getrennt von abgeschlossenen Arbeiten.

Behaupte keine Testergebnisse, KI-Qualitätswerte oder externen Aufrufe, die nicht tatsächlich ausgeführt wurden.
