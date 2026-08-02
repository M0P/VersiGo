Du implementierst AP-21 im Projekt VersiGo.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit, Datenschutz, Datenmodell, UI/UX, Betrieb und Bibliothekspolitik
- `AGENTS.md`
- `dependency-policy.md`
- `prompts/PR-REVIEW.md`
- Die bestehende Authentifizierungs-, Rollen-, Settings-, Profil- und Theme-Implementierung
- Die vorhandene Web-, API-, Worker-, Compose-, CI- und Test-Infrastruktur

Arbeite in einem neuen Branch `feat/AP-21-multi-language-support` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Implementiere vollständige Mehrsprachigkeit für Deutsch und Englisch. Englisch ist die globale Standardsprache. Alle authentifizierten Nutzer, einschließlich `READ_ONLY`, erhalten in der Settings-UI eine explizite, zugängliche und funktionierende Sprachwahl.

Dieses Arbeitspaket erweitert ausdrücklich die bisherige Berechtigungsregel für persönliche Einstellungen:
- `READ_ONLY` darf ausschließlich seine eigene Spracheinstellung lesen und ändern.
- Für `READ_ONLY` gilt diese Spracheinstellung nur innerhalb der aktuellen authentifizierten Session und wird nicht dauerhaft persistiert.
- `READ_ONLY` erhält dadurch keinen Zugriff auf Anzeigename, Theme, Zeitzone, sonstige Profileinstellungen, Haushaltsdaten, Nutzerverwaltung oder Systemeinstellungen.
- `USER` und `ADMIN` behalten ihre bereits zulässigen persönlichen Einstellungen.
- Systemweite Sprachvorgaben oder die Bearbeitung von Übersetzungen über die Anwendungs-UI sind nicht Bestandteil dieses Arbeitspakets.

Die Lösung muss modular, erweiterbar, typsicher, testbar und ohne doppelte Übersetzungslogik aufgebaut sein.

## Begriffe und verbindlicher Übersetzungsumfang

Als nutzersichtbar gelten mindestens:
- Navigation, Seitentitel, Überschriften, Buttons, Links, Menüs und Tooltips
- Formulare, Labels, Placeholders, Hilfetexte, Validierungsfehler und Pflichtfeldhinweise
- Erfolgs-, Lade-, Leer-, Fehler-, Berechtigungs- und Degradationszustände
- Dialoge, Bestätigungen und Hinweise für destruktive Aktionen
- Tabellenüberschriften, Filter, Suche, Pagination, Statuswerte und Datums-/Zahlenformate
- Login, Logout, lokale Authentifizierung, OIDC-bezogene sichtbare Hinweise und Session-Fehler
- Versicherungen, Kosten, Dokumente, Haushalts-/Freigabefunktionen, Admin-, Profil- und Systemeinstellungen
- AI- und Integrationsfunktionen einschließlich nicht konfigurierter, fehlerhafter oder deaktivierter Zustände
- Upload-, Download-, Import-, Export-, Lösch-, Backup-, Restore- und Wartungshinweise, sofern in der UI vorhanden
- Zugänglichkeitstexte wie `aria-label`, Screenreader-Texte, Bildbeschreibungen, Fokus-/Statusmeldungen und Tastaturhinweise
- Alle durch die Web-UI generierten E-Mails, Benachrichtigungen oder exportierten menschenlesbaren Texte, soweit sie im Repository implementiert sind
- API-Fehlertexte, sofern diese direkt in der UI angezeigt werden oder für Endnutzer bestimmt sind

Nicht übersetzt werden müssen:
- Geheimnisse, technische IDs, Datenbank- und Infrastrukturwerte
- strukturierte Logs, Audit-Rohdaten, Metriken und maschinenlesbare API-Fehlercodes
- vom Nutzer eingegebene freie Texte, Dokumentinhalte oder externe Datenquellen
- Dokumentation im Repository, sofern sie nicht als Teil der Web-UI ausgeliefert wird

Technische Fehler dürfen in Logs weiterhin technisch präzise sein. Die UI muss jedoch eine sichere, verständliche und lokalisierte Endnutzer-Meldung anzeigen, ohne Interna, Secrets oder personenbezogene Daten offenzulegen.

## Architektur und Sprachdateien

- Prüfe zuerst die vorhandene Next.js-, API- und Shared-Package-Architektur sowie vorhandene Lokalisierungsmechanismen.
- Verwende eine zentrale, etablierte und mit dem Projekt kompatible i18n-Lösung. Bevorzuge vorhandene Abhängigkeiten oder Framework-Fähigkeiten. Eine neue Abhängigkeit ist nur zulässig, wenn sie gemäß `dependency-policy.md` geprüft, begründet und dokumentiert wird.
- Die Übersetzungen müssen in externen, versionierten Sprachdateien liegen, zum Beispiel unter einem klaren, dokumentierten Pfad wie `apps/web/src/i18n/locales/en/...` und `apps/web/src/i18n/locales/de/...`.
- Organisiere Schlüssel modular nach Domänen oder Feature-Slices, etwa `common`, `auth`, `navigation`, `settings`, `policies`, `documents`, `costs`, `admin`, `integrations` und `validation`. Die konkrete Struktur muss zur tatsächlichen Repository-Architektur passen.
- Keine große unstrukturierte Übersetzungsdatei und keine fachfremden Querimporte zwischen Feature-Slices.
- Englisch (`en`) ist die kanonische Referenzsprache und enthält jeden gültigen Übersetzungsschlüssel genau einmal.
- Deutsch (`de`) muss exakt denselben Schlüsselbestand wie Englisch besitzen. Fehlende deutsche Einträge, zusätzliche nicht dokumentierte Schlüssel, leere Werte, Fallbacks auf englische Texte und zur Laufzeit fehlende Schlüssel sind für die Beta nicht akzeptabel.
- Ersetze alle übersetzbaren, hardcodierten UI-Texte durch lokalisierte Schlüssel. Dies gilt auch für Bedienelemente, Fehlermeldungen, Modal-Dialoge, Statusmeldungen und Accessibility-Texte.
- Übersetzungsschlüssel müssen semantisch und stabil sein. Sie dürfen nicht aus dem englischen Satztext als Schlüssel bestehen.
- Keine dynamisch zusammengesetzten Sätze, wenn dadurch Grammatik, Reihenfolge oder Übersetzbarkeit beeinträchtigt wird. Verwende Platzhalter, Pluralregeln, Kontextvarianten und lokalisierungsfähige Formatierung.
- Verwende für Datum, Uhrzeit, Zahlen, Währungen, Prozentwerte und Pluralformen die aktive Locale. Fachlich gespeicherte Werte und API-Verträge bleiben sprachneutral.
- `en` und `de` sind ausschließlich erlaubte Sprachen dieses Arbeitspakets. Nicht unterstützte Sprachwerte müssen sicher auf Englisch zurückfallen und dürfen nicht unvalidiert gespeichert werden.
- Die Architektur muss das spätere Hinzufügen weiterer Sprachen ermöglichen, ohne Komponentenlogik oder API-Verträge umzubauen.

## Sprachauflösung und Persistenz

Implementiere eine eindeutige, dokumentierte Prioritätsreihenfolge:

### Für `USER` und `ADMIN`

1. Gültige, dauerhaft gespeicherte persönliche Sprachpräferenz des angemeldeten Nutzers.
2. Sprache aus einer vertrauenswürdigen, unterstützten Anfrage-/Browserpräferenz bei nicht gespeicherter Auswahl, sofern dies mit dem bestehenden Authentifizierungs- und Rendering-Modell sicher möglich ist.
3. Englisch (`en`) als verbindlicher Fallback und Standard.

### Für `READ_ONLY`

1. Gültige Sprachwahl innerhalb der aktuellen authentifizierten Session.
2. Sprache aus einer vertrauenswürdigen, unterstützten Anfrage-/Browserpräferenz, wenn innerhalb der Session noch keine Sprachwahl erfolgt ist.
3. Englisch (`en`) als verbindlicher Fallback und Standard.

Anforderungen:

- Die Standardsprache für neue und bestehende Nutzer ohne gespeicherte oder sessionbezogene Wahl ist Englisch.
- `USER` und `ADMIN` speichern ihre Sprachpräferenz serverseitig, pro Nutzer, typisiert und validiert. Die Einstellung bleibt nach erneutem Login, Browserwechsel und Neuladen erhalten.
- `READ_ONLY` darf seine Sprache ausschließlich für die laufende authentifizierte Session ändern. Die Auswahl wird mit dem Ende der Session verworfen, insbesondere nach Logout, Session-Ablauf oder Widerruf der Session.
- Die Sprachwahl eines `READ_ONLY`-Nutzers darf nicht in der Datenbank, einem dauerhaften Benutzerprofil, Local Storage, IndexedDB, einem langlebigen Client-Cookie, einem Audit-Event oder einer sonstigen persistenten Ablage gespeichert werden.
- Für `READ_ONLY` darf die Sprache nur in einem bestehenden, angemessen geschützten Session-Mechanismus oder einer gleichwertig kurzlebigen, serverseitig kontrollierten Session-Repräsentation gehalten werden. Die Implementierung muss mit den bestehenden Session-, Cookie-, CSRF- und Proxy-Sicherheitsregeln vereinbar sein.
- Ein Seiten-Reload innerhalb einer weiterhin gültigen Session darf die für `READ_ONLY` gewählte Sprache beibehalten, sofern die Session selbst fortbesteht.
- Nach einem neuen Login eines `READ_ONLY`-Nutzers greift erneut die Browserpräferenz oder Englisch, sofern der Nutzer in der neuen Session nicht erneut eine Sprache auswählt.
- Falls eine Datenbankmigration für `USER` und `ADMIN` nötig ist, muss sie für bestehende Nutzer einen sicheren englischen Default ergeben und mit der vorhandenen Migrationsstrategie kompatibel sein.
- Die Sprachänderung muss ohne erneute Anmeldung wirksam werden. Falls das technische Rendering einen vollständigen Reload erfordert, muss dieser kontrolliert erfolgen und die neue Sprache anschließend sofort sichtbar sein.
- Eine Änderung der Sprache darf weder Theme, Akzentfarbe, Zeitzone, Benutzerprofil, Haushaltsdaten noch Systemkonfiguration verändern.
- Die API darf ausschließlich dem angemeldeten Nutzer das Lesen und Schreiben seiner eigenen Sprachpräferenz erlauben.
- Ein Nutzer darf niemals die Sprache eines anderen Nutzers setzen oder auslesen.
- Die API muss für `READ_ONLY` strikt zwischen der erlaubten sessionbasierten Sprachwahl und verbotenen dauerhaften Profilpräferenzen unterscheiden.
- Unabhängig von sichtbaren Navigationseinträgen muss die API die Berechtigungen erzwingen.
- Eine Sprachänderung von `USER` oder `ADMIN` ist nur dann zu auditieren, wenn dies mit den bestehenden Datenschutz- und Audit-Regeln für persönliche Präferenzen vereinbar ist.
- Sprachänderungen durch `READ_ONLY` dürfen nicht auditiert werden, sofern das Audit eine dauerhafte, personenbezogene Verhaltenshistorie erzeugen würde. Falls die bestehende Sicherheitsarchitektur ein minimales Session-Sicherheitsereignis zwingend verlangt, darf dieses weder die gewählte Sprache noch einen dauerhaften Präferenzverlauf enthalten.

## Settings-UI und Berechtigungen

Ergänze in der bestehenden Settings- oder Profil-UI einen klaren Bereich „Sprache“ beziehungsweise die lokalisierte Entsprechung.

- Jeder authentifizierte Nutzer, einschließlich `READ_ONLY`, sieht eine explizite Sprachwahl.
- Die Auswahl enthält mindestens:
  - English
  - Deutsch
- Die angezeigten Sprachnamen müssen verständlich, eindeutig und zugänglich sein. Sie können in der jeweiligen Eigenbezeichnung dargestellt werden, zum Beispiel „English“ und „Deutsch“.
- Die aktuell aktive Sprache ist klar erkennbar.
- Die Steuerung muss per Tastatur, Screenreader und Touch bedienbar sein; sie benötigt ein korrektes Label, sichtbaren Fokus, Fehlerfeedback und Erfolgsmeldung.
- Bei einem Speicher- oder Session-Update-Fehler bleibt die zuvor wirksame Sprache aktiv. Die UI zeigt eine lokalisierte Fehlermeldung und bietet eine Wiederholung an.
- Bei erfolgreicher Änderung zeigt die UI die neue Sprache sofort oder nach einem klar kommunizierten, kontrollierten Reload.
- Die UI erläutert `READ_ONLY` verständlich und lokalisiert, dass dessen Sprachwahl nur für die aktuelle Sitzung gilt und nach Abmeldung oder Ablauf der Sitzung zurückgesetzt wird.
- `READ_ONLY` darf ausschließlich diesen minimalen Spracheinstellungsbereich aufrufen. Andere persönliche oder administrative Settings dürfen nicht sichtbar, ladbar oder über direkte Route/API erreichbar sein.
- Falls die bestehende Settings-Seite für `READ_ONLY` komplett gesperrt ist, implementiere eine minimale, abgesicherte Settings-Ansicht oder Route nur für die sessionbasierte Sprachpräferenz. Erweitere nicht pauschal den Zugriff auf die gesamte Profilseite.
- Prüfe jede Navigation, jeden Button, jedes Formular und jeden Erfolg-/Fehlerzustand dieser Funktion manuell und automatisiert.

## Vollständigkeit und 100-Prozent-Abdeckung

„100 Prozent Abdeckung“ bedeutet für dieses Arbeitspaket:

1. Vollständige Schlüsselparität:
   - Jeder englische Schlüssel existiert genau einmal auf Deutsch.
   - Jeder deutsche Schlüssel existiert genau einmal auf Englisch.
   - Keine leeren Übersetzungswerte.
   - Keine unabsichtlichen Fallbacks von Deutsch auf Englisch oder umgekehrt.
   - Keine nicht verwendeten oder nicht inventarisierten Schlüssel, soweit dies automatisiert prüfbar ist.

2. Vollständige UI-Abdeckung:
   - Jeder aktuell implementierte nutzersichtbare Text im Scope ist in Deutsch und Englisch verfügbar.
   - Dies schließt alle sichtbaren Routen, Rollen, Dialoge, Formzustände, Fehlerzustände, leeren Zustände, Ladezustände und Accessibility-Texte ein.
   - Optional deaktivierte oder falsch konfigurierte Integrationen müssen ebenfalls lokalisierte Hinweise liefern.

3. Vollständige Testabdeckung:
   - Es existiert eine automatisierte Prüfung der Schlüsselparität und leerer Werte.
   - Der CI-Lauf schlägt fehl, wenn Englisch und Deutsch nicht exakt denselben gültigen Übersetzungsschlüsselbestand haben.
   - Der CI-Lauf schlägt fehl, wenn ein für die Übersetzung markierter Schlüssel zur Laufzeit fehlt.
   - Kritische UI-Flows werden mindestens in Englisch und Deutsch automatisiert getestet.
   - Die wichtigsten Routen und Rollen werden mit beiden Sprachen per Smoke- oder E2E-Test geprüft.
   - Mindestens ein Test prüft, dass `READ_ONLY` ausschließlich die Sprache ändern kann und keinen erweiterten Zugriff auf Einstellungen erhält.
   - Mindestens ein Test prüft, dass eine Sprachwahl von `READ_ONLY` innerhalb derselben gültigen Session nach einem Reload erhalten bleibt.
   - Mindestens ein Test prüft, dass eine Sprachwahl von `READ_ONLY` nach Logout, Session-Ablauf oder einer neu aufgebauten Session nicht mehr vorhanden ist.
   - Mindestens ein Test prüft, dass eine Sprachwahl von `READ_ONLY` nicht in der Datenbank, einem dauerhaften Benutzerprofil oder einer sonstigen persistenten Client-Ablage gespeichert wird.
   - Mindestens ein Test prüft, dass die Sprachwahl von `USER` und `ADMIN` nach einer neuen Session weiterhin vorhanden ist.
   - Mindestens ein Test prüft die Standardauflösung auf Englisch bei einem neuen Nutzer und einem `READ_ONLY`-Nutzer nach Beginn einer neuen Session.
   - Mindestens ein Test prüft einen ungültigen Sprachwert und den sicheren Fallback auf Englisch.
   - Mindestens ein Test prüft lokalisierte Validierungs-, Fehler- und Erfolgszustände.

4. Repository-Prüfung:
   - Führe eine systematische Suche nach verbleibenden hardcodierten nutzersichtbaren Texten im Web-Frontend durch.
   - Dokumentiere begründete Ausnahmen explizit, etwa technische Protokolltexte oder nicht nutzersichtbare Tests.
   - Ergänze eine automatisierbare Prüfung, Lint-Regel oder einen anderen robusten Guard, der neue nicht erlaubte hardcodierte UI-Texte möglichst früh erkennt. Sie darf keine unverhältnismäßig vielen Fehlalarme erzeugen.

## Datenschutz, Sicherheit und Qualität

- Die Spracheinstellung ist ein personenbezogenes Präferenzdatum und darf ausschließlich im notwendigen Umfang gespeichert werden.
- Keine Sprachdatei, Fehlermeldung oder Übersetzungsfunktion darf Secrets, interne Endpunkte, Stacktraces oder vertrauliche Daten offenlegen.
- Lokalisierung darf keine Berechtigungsprüfung, Mandantentrennung, CSRF-/Session-Schutz, Validierung oder Fehlerbehandlung umgehen.
- Übersetzungsdateien dürfen nicht dynamisch aus nicht vertrauenswürdigen Nutzer-, Netzwerk- oder Dateiquellen geladen werden.
- Führe keine externe Übersetzungs-API, Telemetrie, Tracking- oder Cloud-Abhängigkeit ein.
- Prüfe die Auswirkung auf SSR/CSR, Hydration, Caching, Routing, SEO soweit relevant, Bundle-Größe und Build-Dauer.
- Sprachpakete sollen nur in dem Umfang geladen werden, der mit der aktiven Sprache und dem vorhandenen Rendering-Modell sinnvoll ist. Vermeide unnötiges Laden aller Sprachdateien, sofern dies ohne unangemessene Komplexität möglich ist.
- Aktualisiere die vorhandene Design-System- und Accessibility-Dokumentation um Anforderungen für lokalisierte Texte, längere Texte und sprachabhängige Layouts.
- Stelle sicher, dass die UI bei längeren deutschen Texten auf mobilen, Tablet- und Desktop-Breiten weder überläuft noch Bedienelemente unzugänglich macht.

## Dokumentation

Aktualisiere mindestens:
- README, sofern Benutzerpräferenzen oder verfügbare Sprachen genannt werden
- `docs/04-data-model.md`, falls Persistenz oder Migration ergänzt wird
- `docs/03-architecture.md` und relevante ADRs für Architekturentscheidungen
- `docs/07-security-privacy.md` für Speicherung und Zugriff auf persönliche Sprachpräferenzen
- `docs/11-ui-ux.md` für Sprachwahl, Accessibility, Textlängen und Lokalisierungsregeln
- Betriebs- und Konfigurationsdokumentation, sofern Sprachauflösung, Default oder Deployment-relevante Aspekte betroffen sind
- Entwicklerdokumentation für das Anlegen neuer Übersetzungsschlüssel, Module und künftig zusätzlicher Sprachen

Die Entwicklerdokumentation muss mindestens erklären:
- Verzeichnisstruktur und Namenskonventionen der Sprachdateien
- Referenzsprache und Schlüsselparität
- Regeln für Platzhalter, Pluralisierung und Formatierung
- Vorgehen zum Ergänzen eines neuen UI-Textes
- Vorgehen zum Hinzufügen einer weiteren Sprache
- Ausführung der Vollständigkeits- und Lokalisierungstests
- Verbot hardcodierter nutzersichtbarer Texte

## Nicht im Scope

- Eine automatische Übersetzung durch AI oder externe Übersetzungsdienste.
- Weitere produktiv auswählbare Sprachen außer Englisch und Deutsch.
- Übersetzung hochgeladener Dokumente, benutzererstellter Freitexte oder externer Versicherungsdaten.
- Sprachabhängige Änderung fachlicher Daten, Verträge, Rollen oder Berechtigungen.
- Globale, durch Administratoren erzwungene Spracheinstellungen für andere Nutzer.
- Erweiterter allgemeiner Settings-Zugriff für `READ_ONLY` über die isolierte Sprachpräferenz hinaus.
- Öffentlicher Betrieb, Tracking oder Übermittlung von Übersetzungs-/Nutzungsdaten an Dritte.

Akzeptanzkriterien:
- Englisch (`en`) ist die verbindliche Standardsprache für neue und bestehende Nutzer ohne gespeicherte oder sessionbezogene Präferenz.
- Deutsch (`de`) und Englisch (`en`) sind vollständig implementiert und auswählbar.
- `USER` und `ADMIN` können ausschließlich ihre eigene Sprache dauerhaft in der UI lesen und ändern.
- `READ_ONLY` kann ausschließlich seine eigene Sprache innerhalb der aktuellen authentifizierten Session in der UI lesen und ändern.
- Die Sprachwahl von `READ_ONLY` wird nicht dauerhaft gespeichert und ist nach Logout, Session-Ablauf oder einer neuen Session nicht mehr vorhanden.
- Die Sprachwahl von `READ_ONLY` darf weder Datenbankwerte noch dauerhafte Profilpräferenzen, Local Storage, IndexedDB, langlebige Client-Cookies oder dauerhafte Audit-Daten erzeugen.
- `READ_ONLY` erhält durch diese Erweiterung keinen Zugriff auf andere persönliche oder administrative Settings.
- Die Sprachpräferenz von `USER` und `ADMIN` wird serverseitig, pro Nutzer, typisiert und validiert gespeichert und bleibt nach einer neuen Session erhalten.
- Alle Übersetzungen liegen in externen, modular organisierten und versionierten Sprachdateien.
- Die englischen und deutschen Sprachdateien besitzen exakt denselben vollständigen Schlüsselbestand; es gibt keine leeren Werte und keine stillen Fallbacks.
- Alle derzeit implementierten nutzersichtbaren Texte im definierten Scope sind in Deutsch und Englisch abgedeckt.
- Hardcodierte, übersetzbare UI-Texte sind entfernt oder als dokumentierte technische Ausnahme begründet.
- Datum, Uhrzeit, Zahlen, Währungen und Pluralformen folgen der aktiven Sprache, soweit sie in der UI verwendet werden.
- Die Sprachwahl ist responsiv, zugänglich und in allen Erfolg-, Lade- und Fehlerzuständen verständlich bedienbar.
- API und UI erzwingen Zugriff ausschließlich auf die eigene Präferenz sowie die Trennung zwischen dauerhafter Nutzerpräferenz und sessionbasierter `READ_ONLY`-Präferenz.
- Schlüsselparität, fehlende Werte, ungültige Sprachwerte, englischer Default, dauerhafte Persistenz für `USER`/`ADMIN`, sessionbezogene Persistenz und Verwerfung für `READ_ONLY` sowie die `READ_ONLY`-Isolation sind automatisiert getestet.
- Alle bestehenden Qualitätsprüfungen, die vollständige Docker-Compose-Testpipeline, Build und Compose-Smoke-Test sind erfolgreich.
- Dokumentation, Datenmodell, Architektur, Datenschutz, UI/UX und Entwickleranleitung sind aktualisiert.

Vorgehen:
1. Gib zunächst ausschließlich folgende Inhalte aus:
   - Ziel und Abgrenzung
   - Inventar aller bestehenden nutzersichtbaren Texte, Routen, Rollen und UI-Zustände
   - Analyse der bestehenden Settings-Berechtigungen, insbesondere der notwendigen isolierten `READ_ONLY`-Freigabe
   - technische Lösung und Architekturentscheidung für i18n, externe Sprachdateien, Routing/Rendering und Persistenz
   - vorgeschlagene Struktur der Übersetzungsmodule und Schlüsselkonventionen
   - Plan zur vollständigen Deutsch-/Englisch-Paritätsprüfung
   - Liste betroffener Dateien und erforderlicher Migrationen
   - neue Abhängigkeiten samt Maintenance-Prüfung oder die explizite Aussage, dass keine neuen Abhängigkeiten nötig sind
   - Sicherheits-, Datenschutz-, Accessibility- und Performance-Risiken
   - Testplan inklusive UI-, API-, E2E-, Compose- und CI-Prüfungen
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Halte Feature-Grenzen strikt ein.
4. Ergänze Übersetzungen gleichzeitig mit jeder betroffenen UI-Änderung; es darf zu keinem Zeitpunkt im finalen Branch eine unvollständige `de`- oder `en`-Datei geben.
5. Führe vor dem finalen Testlauf den aktuellen `main` in den Branch ein.
6. Führe mindestens Formatierung, Linting, Typecheck, Unit-Tests, API-/Integrationstests, UI-/E2E-Tests in beiden Sprachen, Schlüsselparitätsprüfung, vollständigen Docker-Compose-Testlauf, Build und Compose-Smoke-Test aus.
7. Führe den unabhängigen, read-only `@code-reviewer`-Loop nach Repository-Vorgabe durch, speichere die Reviews wortgetreu unter `docs/reviews/` und behebe alle Critical-, High- und Medium-Befunde.
8. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-21): multi-language support`

PR-Beschreibung muss enthalten:
- Ziel, Scope und Architekturentscheidung
- Liste geänderter Dateien und Migrationen
- vollständiges Übersetzungsinventar sowie die Struktur der Sprachmodule
- Nachweis der exakten Schlüsselparität von `en` und `de`
- Nachweis der Suche und Behandlung verbliebener hardcodierter UI-Texte
- Nachweis der Sprachwahl für `READ_ONLY`, `USER` und `ADMIN`, einschließlich Berechtigungsabgrenzung
- Nachweis des englischen Defaults, der Persistenz und des sicheren Fallbacks bei ungültigen Werten
- Ausgeführte Befehle und Ergebnisse aller Tests in beiden Sprachen
- Neue Abhängigkeiten mit Maintenance-Prüfung
- Sicherheits-, Datenschutz-, Accessibility- und Performance-Bewertung
- Bekannte Grenzen oder bewusst nicht umgesetzte Teilfunktionen

Merge-Gate:
Der Pull Request darf nur nach erfüllten Akzeptanzkriterien, exakter automatisierter Schlüsselparität zwischen Deutsch und Englisch, erfolgreichem Test aller kritischen Flows in beiden Sprachen, vollständig grüner CI, aktuellem `main` im Branch und unabhängigem Review gemergt werden. Ein Modell darf den eigenen Pull Request nicht freigeben oder mergen. Wenn ein Check fehlschlägt, behebe ihn im selben Branch und aktualisiere Übersetzungen, Tests, Dokumentation und Pull Request.
