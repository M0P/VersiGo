# AP: Native Nutzungserfahrung für Smartphone und Tablet

## Ziel

Die Insura-Oberfläche ist bisher auf die Nutzung im Desktop-Browser ausgelegt. Sie soll für Smartphone und Tablet **gezielt gestaltet** werden. Reines Skalieren oder Umbrechen des Desktop-Layouts reicht nicht aus.

Wo Touch-Bedienung, kleine Bildschirme oder Hoch- und Querformat es erfordern, werden Navigation, Interaktionsmuster, Formulare, Listen und Dokumentansichten eigenständig umgesetzt. Die fachliche Funktionalität bleibt auf allen Geräten gleichwertig.

## Leitprinzipien

- Mobile-first für Kernaufgaben: Versicherungen finden, Details prüfen, Dokumente ansehen, Kosten erfassen, Dokumente hinzufügen.
- Touch ist die primäre Eingabeform, Maus und Tastatur bleiben vollständig unterstützt.
- Keine Funktion darf ausschließlich über Hover erreichbar sein.
- Inhalte dürfen nicht horizontal überlaufen, außer in bewusst scrollbaren Datenbereichen.
- Die Desktop-Oberfläche bleibt funktional unverändert, sofern keine Verbesserung erforderlich ist.
- Bestehende Komponenten, Design-Tokens und das vorhandene Frontend-Framework werden weiterverwendet; keine zweite UI-Bibliothek einführen.
- Änderungen erfolgen schrittweise je Bereich und sind jeweils testbar.

## Geräteklassen und Breakpoints

Definiere zentrale Breakpoints und Geräteklassen in einer gemeinsamen Konfiguration. Verteile keine abweichenden Pixelwerte in einzelnen Komponenten.

| Klasse | Richtwert | Layoutprinzip |
|---|---|---|
| Smartphone Hochformat | bis ca. 639 px | Einspaltig, Bottom-Navigation, Vollbild-Ansichten |
| Smartphone Querformat / kleines Tablet | ca. 640–1023 px | Kompakte Zweispaltigkeit, reduzierte Navigation |
| Tablet | ca. 768–1279 px | Master-Detail, kollabierbare Seitenleiste |
| Desktop | ab ca. 1280 px | Bestehendes Layout |

Die Werte sind Richtwerte und dürfen an das vorhandene Design-System angepasst werden. Zusätzlich muss die Unterscheidung nach Eingabeart erfolgen:

- `pointer: coarse` bzw. `hover: none` für Touch-Optimierungen.
- Orientierungswechsel ohne Datenverlust und ohne Layoutbruch.
- Tablets mit Tastatur oder Maus bleiben vollständig bedienbar.

## Globale Grundlagen

### Viewport und sichere Bereiche

- Der Viewport wird über die vom Framework vorgesehene Konfiguration gesetzt; doppelte Viewport-Meta-Tags sind zu entfernen. [web:26]
- Verwende `viewport-fit=cover` und berücksichtige `env(safe-area-inset-*)` für feste Leisten, Bottom-Navigation, Sheets und Dialoge. [web:35]
- Das Zoomen darf nicht deaktiviert werden. Die Oberfläche muss bei Browser-Zoom und vergrößerter Systemschrift nutzbar bleiben.
- Verwende dynamische Viewport-Einheiten (`dvh`, `svh`) statt `100vh`, damit die mobile Browserleiste keine Inhalte verdeckt. [web:28]
- Teste Tastatureinblendung: Fokussierte Eingabefelder und primäre Aktionen dürfen nicht von der Bildschirmtastatur verdeckt werden.

### Touch-Ziele und Abstände

- Interaktive Ziele müssen mindestens 24 × 24 CSS-Pixel groß sein oder ausreichend Abstand zu Nachbarn haben (WCAG 2.5.8, Level AA). [web:27]
- Für Touch-Oberflächen gilt als Projektstandard mindestens 44 × 44 px; Google empfiehlt 48 × 48 px bei mindestens 8 px Abstand. [web:30][web:32]
- Gemessen wird die gesamte Trefferfläche einschließlich Innenabstand, nicht nur das sichtbare Icon. [web:36]
- Icon-Buttons, Tabellenaktionen, Checkboxen, Chips und Menüeinträge sind entsprechend zu vergrößern.
- Eng beieinanderliegende destruktive und konstruktive Aktionen müssen räumlich getrennt werden.

### Typografie und Lesbarkeit

- Basisschriftgröße für Fließtext mindestens 16 px, damit mobile Browser Eingabefelder nicht automatisch zoomen.
- Ausreichende Zeilenhöhe, Kontrast und Textskalierung.
- Lange Namen, Policennummern, E-Mail-Adressen und Dateinamen müssen sauber umbrechen oder gekürzt werden, ohne Information zu verlieren.
- Zahlen, Beträge und Datumswerte werden konsistent und gut lesbar dargestellt.

### Hover und Gesten

- Hover-Inhalte (Tooltips, Aktionsmenüs, Zeilenaktionen) erhalten Touch-Alternativen.
- Gesten wie Wischen sind optional und niemals der einzige Weg zu einer Funktion.
- Verhindere unbeabsichtigtes horizontales Wischen bei verschachtelten Scrollbereichen.
- Schaffe klare Pressed-, Fokus- und Ladezustände statt reiner Hover-Effekte.

## Navigation

### Smartphone

- Ersetze die Desktop-Seitenleiste durch eine **Bottom-Navigation** mit maximal fünf Hauptzielen.
- Seltener genutzte Bereiche liegen in einem „Mehr“-Menü bzw. einer Seitenschublade.
- Aktuelle Position ist eindeutig erkennbar.
- Detailseiten erhalten eine klare Zurück-Navigation und einen verständlichen Seitentitel in der Kopfzeile.
- Primäre Aktionen („Neu“, „Dokument hinzufügen“) sind im Daumenbereich erreichbar, beispielsweise als Floating Action Button oder fixierte Aktionsleiste.
- Feste Leisten dürfen Inhalte nicht dauerhaft überdecken; die Inhaltsbereiche erhalten passenden unteren Abstand.

### Tablet

- Im Querformat: ausklappbare oder eingeklappte Seitenleiste.
- Im Hochformat: Navigation als Schublade oder kompakte Rail.
- Nutze den Platz für Master-Detail-Layouts, beispielsweise Versicherungsliste links und Detailbereich rechts.
- Tablet-spezifische Layouts dürfen nicht einfach vergrößerte Smartphone-Ansichten sein.

## Seiten und Komponenten

### Versicherungsübersicht

- Smartphone: Kartenliste statt Tabelle mit den wichtigsten Informationen (Name, Anbieter, Kategorie, Beitrag, nächste Fälligkeit, Status).
- Suche und Filter in einem Bottom-Sheet oder Vollbild-Filterdialog; aktive Filter als sichtbare Chips.
- Sortierung als einfache Auswahl.
- Tablet: Master-Detail oder Kartenraster mit zwei Spalten.
- Leere Zustände, Ladezustand und Fehlerzustände sind für kleine Bildschirme gestaltet.

### Versicherungsdetails

- Smartphone: Inhalte in klar getrennten Abschnitten oder Tabs mit horizontal scrollbarer, gut sichtbarer Tab-Leiste.
- Wichtige Informationen und Aktionen stehen oben; sekundäre Details sind einklappbar.
- Mehrspaltige Desktop-Formulare werden einspaltig.
- Tablet: zweispaltige Darstellung mit stabilen Spalten und sinnvollem Scrollverhalten.
- Mitversicherte Personen, Portal-Links, Kosten und Dokumente erhalten jeweils eigene mobile Darstellungen.

### Tabellen und Datenlisten

- Breite Tabellen werden auf dem Smartphone nicht nur verkleinert.
- Verwende je Inhalt eine geeignete Darstellung: Karten, Zeilen mit Detailausklappung oder kontrolliert scrollbare Tabellen mit fixierter Identifikationsspalte.
- Auswahl, Sortierung, Filter und Zeilenaktionen müssen weiterhin erreichbar sein.
- Auf dem Tablet bleibt die Tabelle erhalten, sofern Lesbarkeit und Touch-Bedienung gewährleistet sind.

### Formulare

- Einspaltige Formulare auf dem Smartphone mit sichtbaren Labels; Platzhalter ersetzen keine Labels.
- Passende Eingabetypen und Tastaturen (`email`, `tel`, `numeric`/`decimal`, Datum).
- `autocomplete`, `inputmode` und `enterkeyhint` gezielt einsetzen.
- Fehlermeldungen stehen direkt am Feld, und der Fokus springt bei Validierungsfehlern zum ersten Fehler.
- Primäre Speichern-/Abbrechen-Aktionen bleiben in einer fixierten, safe-area-konformen Aktionsleiste erreichbar.
- Lange Formulare werden bei Bedarf in Schritte oder Abschnitte unterteilt, ohne Zwischenstände zu verlieren.
- Auswahlfelder mit vielen Optionen verwenden suchbare, touch-taugliche Auswahlansichten statt kleiner Desktop-Dropdowns.
- Datums- und Betragsfelder sind ohne exakte Mausbedienung nutzbar.

### Dialoge, Menüs und Overlays

- Smartphone: Dialoge als Bottom-Sheets oder Vollbildseiten, abhängig von Inhaltsumfang.
- Tablet: zentrierte Dialoge oder seitliche Panels.
- Kontextmenüs werden als Aktionsblatt statt kleiner Popover umgesetzt.
- Overlays dürfen Browser-Zurück-Gesten nicht stören: Zurück schließt das oberste Overlay, nicht die gesamte Seite.
- Scroll-Locking des Hintergrunds und korrekter Fokusfang.
- Schließen-Schaltflächen sind groß und im sicheren Bereich platziert.

### Dokumente

- Smartphone: Dokumente als Liste mit Vorschaubild oder Dateisymbol, Titel, Typ, Datum und Herkunft.
- Vorschau im Vollbild mit Zoom, Zurück-Aktion, Download und Teilen.
- Tablet: Liste und Vorschau nebeneinander, soweit Platz vorhanden ist.
- PDF-, Bild- und Dokumentvorschau müssen Pinch-to-Zoom und Scrollen unterstützen, ohne den Seitenscroll zu blockieren.
- Dokument hinzufügen: Auswahl aus Kamera, Fotos und Dateien; die Optionen richten sich nach den vom Gerät unterstützten Möglichkeiten.
- Mehrere Dateien und fehlgeschlagene Uploads werden mit eindeutigem Fortschritts- und Fehlerstatus angezeigt.
- Große Dateien und instabile Mobilverbindungen müssen sauber behandelt werden; Wiederholung nach Fehler anbieten.
- Paperless-ngx-Links und -Verknüpfungen bleiben bedienbar; Tag- und Dokumentauswahl sind touchfreundlich.

### Kosten und Auswertungen

- Diagramme sind auf kleinen Bildschirmen lesbar, nicht nur verkleinert.
- Tooltips werden durch Tippen aktiviert.
- Legenden und Beschriftungen passen sich an oder werden alternativ als Liste dargestellt.
- Wichtige Kennzahlen stehen als Karten oberhalb detaillierter Diagramme.
- Vergleichs- und Detailtabellen folgen den Regeln für mobile Tabellen.

### Login und Konto

- Formularfelder unterstützen Passwortmanager und automatisches Ausfüllen.
- Anzeigen-/Verbergen-Schalter für Passwörter sind groß genug.
- OIDC-/Redirect-Abläufe müssen auf mobilen Browsern und aus installierten Web-Apps funktionieren.
- Sitzungsablauf und Fehler führen zu einer verständlichen Aktion.

## Optional: Installierbare Web-App (PWA)

Prüfe und implementiere eine installierbare Web-App, soweit der Aufwand angemessen ist.

- Web-App-Manifest mit Name, Icons, Theme-Farben und Start-URL. [web:31]
- Standalone-Darstellung mit korrekt behandelten Safe Areas. [web:31][web:35]
- Kein Offline-Caching vertraulicher Versicherungsdaten ohne ausdrückliche Sicherheits- und Datenschutzentscheidung.
- Falls ein Service Worker eingesetzt wird, sind zu cachende Inhalte strikt zu begrenzen.
- Push-Benachrichtigungen, Offline-Bearbeitung und App-Store-Pakete sind nicht Teil dieses AP.

## Performance

- Optimiere für mittelstarke Smartphones und mobile Netzwerke.
- Lade große Komponenten, Diagramme und Dokumentvorschauen bedarfsgesteuert.
- Verwende responsive Bilder und vermeide unnötig große Vorschaubilder.
- Begrenze Layoutverschiebungen durch Platzhalter oder feste Medienproportionen.
- Listen mit vielen Einträgen verwenden Paginierung oder Virtualisierung, wenn dies für flüssiges Scrollen erforderlich ist.
- Vermeide teure Animationen; respektiere `prefers-reduced-motion`.
- Zielwerte für Core Web Vitals sind vor Umsetzung für die wichtigsten Seiten zu messen und im Abschlussbericht zu dokumentieren.

## Barrierefreiheit

- Die Anforderungen gelten auch für Screenreader (VoiceOver, TalkBack), Tastatur- und Schaltersteuerung.
- Sinnvolle Fokusreihenfolge bei Navigation, Sheets und Dialogen.
- Beschriftungen für Icon-Buttons und aussagekräftige Landmarks.
- Kontraste im hellen und dunklen Modus, soweit beide unterstützt werden.
- Orientierung nicht sperren.
- Inhalte bleiben bei 200 % Zoom nutzbar.
- Statusmeldungen (Speichern, Upload, Fehler) werden zugänglich angekündigt.

## Umsetzungsvorgehen

1. **Bestandsaufnahme:** Layout-Shell, Navigation, Seiten, Tabellen, Formulare, Dialoge, Dokumentansichten und vorhandene Responsive-Regeln inventarisieren. Probleme je Gerätegröße mit Screenshots dokumentieren.
2. **Fundament:** Zentrale Breakpoints, Touch-Ziel-Standards, Safe-Area-Tokens, Viewport-Konfiguration und gemeinsame Layout-Komponenten schaffen.
3. **App-Shell und Navigation:** Mobile Bottom-Navigation, Tablet-Seitenleiste und Kopfzeilen umsetzen.
4. **Kernseiten:** Versicherungsübersicht, Detailansicht und Dokumentbereich optimieren.
5. **Eingabeabläufe:** Formulare, Dialoge, Auswahlfelder und Uploads anpassen.
6. **Weitere Bereiche:** Kosten, Einstellungen, Admin, Login und sonstige Seiten.
7. **Qualitätssicherung:** Gerätetests, Accessibility, Performance, Regression und Dokumentation.

Jede Phase wird einzeln bewertbar und möglichst getrennt auslieferbar umgesetzt.

## Tests

### Automatisiert

- Responsive Playwright-Tests mit mindestens folgenden Viewports: kleines Smartphone, großes Smartphone, Tablet Hochformat, Tablet Querformat, Desktop.
- Touch-Emulation (`hasTouch`, `isMobile`) für Kernabläufe.
- Prüfung auf horizontale Überläufe auf allen wichtigen Seiten.
- Automatisierte Barrierefreiheitsprüfungen für die wichtigsten Seiten.
- Prüfung der Mindestgrößen interaktiver Elemente.
- Visuelle Regressionstests für definierte Schlüsselansichten.
- Tests für Orientierungswechsel und Tastaturüberlagerung, soweit technisch sinnvoll.

### Manuell auf realen Geräten

- Mindestens ein aktuelles iPhone mit Safari und ein Android-Gerät mit Chrome.
- Mindestens ein iPad bzw. ein Android-Tablet.
- Prüfung von Safe Areas, Tastatur, Datei- und Kameraauswahl, Dokumentvorschau, Login-Redirects und installierter Web-App.
- Ergebnisse werden mit Gerät, Betriebssystem, Browser und Befund dokumentiert.

## Akzeptanzkriterien

- Alle Kernaufgaben sind auf Smartphone und Tablet ohne Desktop-Ansicht, ohne Pinch-Zoom zur Bedienung und ohne horizontales Seiten-Scrollen erledigbar.
- Smartphone nutzt eine dedizierte mobile Navigation; Tablet nutzt ein eigenständiges, platzoptimiertes Layout.
- Alle interaktiven Elemente erfüllen die definierten Mindestgrößen und Abstände.
- Keine Funktion hängt ausschließlich von Hover ab.
- Formulare verwenden passende Eingabetypen und bleiben bei eingeblendeter Tastatur bedienbar.
- Dokumente können mobil betrachtet, heruntergeladen und hinzugefügt werden.
- Tabellen und Diagramme sind auf kleinen Bildschirmen lesbar und nutzbar.
- Safe Areas, Orientierungswechsel und Browserleisten verursachen keine verdeckten oder abgeschnittenen Inhalte.
- Das Desktop-Layout zeigt keine unbeabsichtigten Regressionen.
- Die definierten Barrierefreiheitsprüfungen bestehen ohne kritische Fehler.
- Automatisierte Tests und die dokumentierten Gerätetests liegen vor.

## Nicht Bestandteil

- Native iOS- oder Android-Apps.
- Vollständiger Offline-Modus.
- Push-Benachrichtigungen.
- Neues Corporate Design oder komplette Neugestaltung des visuellen Stils.
- Fachliche Funktionserweiterungen.
- Änderung der Authentifizierungsarchitektur.

## Abschlusslieferung

Liefere:

1. Umgesetzte Änderungen in den bestehenden Frontend-Strukturen.
2. Dokumentation der Breakpoints, Layoutregeln und wiederverwendbaren mobilen Komponenten.
3. Vorher-/Nachher-Screenshots der wichtigsten Seiten für Smartphone und Tablet.
4. Ergebnis der automatisierten Tests.
5. Protokoll der manuellen Gerätetests.
6. Performance- und Accessibility-Auswertung.
7. Liste geänderter Dateien mit kurzer Begründung.
8. Bekannte Einschränkungen und Folgeaufgaben, klar getrennt von abgeschlossenen Arbeiten.

Behaupte keine Gerätetests oder Testergebnisse, die nicht tatsächlich durchgeführt wurden.
