# Bug: Kostenberechnung berücksichtigt nicht alle vergangenen Zeiträume; Brutto/Netto inkonsistent

## Zusammenfassung

In der Kostenansicht einer Versicherung ist die Berechnung von „Bisher gezahlt" und des Kostenplans fehlerhaft. Vergangene Kostenpositionen und Abrechnungszeiträume werden nicht vollständig berücksichtigt. Außerdem werden Brutto- und Nettobeträge nicht sauber getrennt, teilweise fehlerhaft angezeigt und in Summen vermischt.

Zusätzlich treten Darstellungsfehler bei Texten und Datumsformaten auf.

## Beobachtung (Stand 18.10.2026)

### Kostenpositionen (Datenbasis)

| Gültig von | Gültig bis | Brutto | Netto | Frequenz |
|---|---|---|---|---|
| 23.10.2026 | – | – | 718,22 € | Jährlich |
| 23.10.2025 | 23.10.2026 | – | 761,01 € | Jährlich |
| 23.10.2024 | 23.10.2025 | – | 701,59 € | Jährlich |

### Angezeigte Ergebnisse

- **Bisher gezahlt:** 761,01 €
- **Aktuelle Kostenposition:** Jährlich 761,01 € (seit 23.10.2025, bis 23.10.2026)
- **Jahreskosten (brutto):** 761,01 €
- **Jahreskosten (netto):** 761,01 €

### Kostenplan (angezeigt)

| Zeitraum | Beginn | Ende | Betrag | Status |
|---|---|---|---|---|
| 08/2026 | 16.8.2026 | 16.8.2027 | 761,01 € | Angefallen |
| 08/2027 | 16.8.2027 | 16.8.2028 | 718,22 € | Erwartet |

## Fehlerbeschreibung

### 1. Vergangene Zeiträume fehlen

- Der Kostenplan beginnt erst mit dem Zeitraum 08/2026. Die Zeiträume aus den Kostenpositionen 23.10.2024–23.10.2025 (701,59 €) und 23.10.2025–23.10.2026 (761,01 €) fehlen vollständig.
- „Bisher gezahlt" entspricht mit 761,01 € offenbar nur einem einzigen Zeitraum. Die Summe müsste alle angefallenen Zeiträume seit der ersten Kostenposition enthalten.
- Der Beitrag von 701,59 € (erste Kostenposition) fließt in keine Summe ein.
- Vermutung: Die Berechnung betrachtet nur die aktuell gültige Position bzw. nur einen Zeitraum ab dem Stichtag der aktuellen Periode, statt über alle historischen Kostenpositionen zu iterieren.

### 2. Zeiträume des Kostenplans passen nicht zu den Kostenpositionen

- Kostenpositionen beginnen am **23.10.**, die Zeilen des Kostenplans am **16.8.**. Die Herkunft des Datums 16.8. ist aus den Daten nicht nachvollziehbar (eventuell Versicherungsbeginn oder Hauptfälligkeit).
- Es ist ungeklärt, ob die Abrechnungszeiträume am Vertragsbeginn, an der Hauptfälligkeit oder am Beginn der jeweiligen Kostenposition ausgerichtet sind.
- Der Kostenplan ordnet dem Zeitraum 16.8.2026–16.8.2027 den Betrag 761,01 € zu. Diesen Betrag trägt jedoch die Position, die nur bis 23.10.2026 gültig ist. Die ab 23.10.2026 gültige Position (718,22 €) wird erst für 08/2027 verwendet.
- Fällt ein Abrechnungszeitraum über mehrere Kostenpositionen (Preisänderung innerhalb des Zeitraums), ist das Verhalten nicht definiert. Es muss festgelegt werden, ob anteilig (pro rata) gerechnet wird oder ob der Betrag zum Fälligkeitsdatum gilt.

### 3. Brutto und Netto werden nicht sauber verwendet

- In allen Kostenpositionen ist das Feld **Brutto leer** („–"), nur **Netto** ist gepflegt.
- Die Kopfkarte zeigt trotzdem „Jahreskosten (brutto)" mit demselben Wert wie netto (761,01 €). Offenbar fällt die Anzeige stillschweigend auf den Nettowert zurück. Ein Bruttobetrag wird damit angezeigt, der nicht erfasst wurde.
- Brutto und Netto sind in der Kopfkarte immer identisch. Das ist für Versicherungen mit Steuer, Gebühren oder Rabatten fachlich zweifelhaft.
- Unklar ist, auf welchem Wert „Bisher gezahlt", der Kostenplan-Betrag und „Aktuelle Kostenposition" basieren. Die Spalte „Betrag" im Kostenplan und die Überschrift „Bisher gezahlt" nennen keine Basis.
- Tatsächlich gezahlt wird in der Regel der Bruttobetrag. Summen zu „gezahlt" dürfen nicht auf Nettowerten beruhen, wenn Bruttowerte vorhanden sind.

### 4. Weitere Darstellungsfehler

- Umlaute fehlen bzw. sind ersetzt: „Jaehrlich" statt „Jährlich", „Jaereskosten" statt „Jahreskosten" (zusätzlich Tippfehler). Prüfe alle Frequenz-Bezeichnungen (Monatlich, Vierteljährlich, Halbjährlich, Jährlich) sowie alle Labels der Kostenansicht.
- Datumsformate sind uneinheitlich: „16.8.2026" (ohne führende Nullen) im Kostenplan, „23.10.2026" in Kostenpositionen und „18.10.2026" bei „Stand". Verwende überall dasselbe Format (TT.MM.JJJJ).
- Der Status „Angefallen" wird für den Zeitraum 08/2026 vergeben, obwohl dieser bis 16.8.2027 läuft. Es ist zu klären, ob „Angefallen" bedeutet, dass der Zeitraum begonnen hat bzw. fällig war. Die Statuslogik ist zu definieren und zu dokumentieren.

## Erwartetes Verhalten

1. Der Kostenplan enthält **alle** Abrechnungszeiträume von der ersten Kostenposition bzw. dem Versicherungsbeginn bis zur Gegenwart und die zukünftig projizierten Zeiträume.
2. „Bisher gezahlt" ist die Summe aller bis zum Stichtag angefallenen Zeiträume. Für das Beispiel sind mindestens die Zeiträume mit 701,59 € und 761,01 € zu berücksichtigen. Der exakte Wert hängt von der Festlegung der Zeiträume (siehe Punkt 2) ab; ein Beispiel: 701,59 € + 761,01 € = 1.462,60 €, bei zusätzlicher Berücksichtigung des angefallenen Zeitraums 08/2026 (761,01 €) 2.223,61 €.
3. Jede Kostenposition wird korrekt dem jeweils gültigen Zeitraum zugeordnet, auch bei Preisänderungen.
4. Brutto und Netto sind getrennte, eindeutig benannte Werte. Fehlende Werte werden als „nicht erfasst" bzw. „–" angezeigt, nicht mit dem anderen Wert aufgefüllt.
5. Jede Summe und jede Spalte nennt ihre Basis (brutto oder netto).
6. Texte und Datumsformate sind korrekt und einheitlich.

## Reproduktion

1. Versicherung mit jährlicher Frequenz anlegen.
2. Drei Kostenpositionen erfassen: 23.10.2024–23.10.2025 (701,59 € netto), 23.10.2025–23.10.2026 (761,01 € netto), ab 23.10.2026 (718,22 € netto). Bruttobeträge leer lassen.
3. Kostenansicht öffnen, Stichtag 18.10.2026.
4. Beobachten: Kostenplan startet erst bei 08/2026, „Bisher gezahlt" zeigt 761,01 €, Brutto und Netto sind identisch.

## Zu klärende Fachfragen (vor der Umsetzung entscheiden)

- Woran richten sich Abrechnungszeiträume aus: Versicherungsbeginn, Hauptfälligkeit oder Beginn der Kostenposition?
- Ab wann gilt ein Zeitraum als „angefallen" und ab wann als „gezahlt"? Gibt es tatsächliche Zahlungsnachweise (z. B. erfasste Abrechnungen), oder beruht „Bisher gezahlt" ausschließlich auf der Projektion?
- Wie werden Preisänderungen innerhalb eines Zeitraums behandelt (anteilig oder zum Fälligkeitsdatum)?
- Welcher Betrag ist maßgeblich für Summen: brutto, netto oder konfigurierbar?
- Ist Brutto bei fehlender Erfassung ein Pflichtfeld, optional oder aus Netto und Steuersatz berechenbar?
- Wie werden unterjährige Frequenzen (monatlich, vierteljährlich, halbjährlich) in Kostenplan und Summe abgebildet?
- Wie werden Lücken zwischen Kostenpositionen oder Überlappungen behandelt (Validierung vs. Warnhinweis)?

## Anforderungen an die Korrektur

- Analysiere die bestehende Berechnungslogik für „Bisher gezahlt", „Aktuelle Kostenposition", Jahreskosten (brutto/netto) und Kostenplan und dokumentiere die Ursache der Abweichungen.
- Bündele die Berechnung in einer zentralen, getesteten Domänenfunktion. Frontend und Backend verwenden dieselbe Logik; das Frontend rechnet keine eigene Variante.
- Iteriere über alle Kostenpositionen und erzeuge die Zeiträume vollständig und deterministisch.
- Verwende für Geldbeträge keine Gleitkommaarithmetik (Decimal bzw. ganzzahlige Cent-Beträge) und runde nachvollziehbar.
- Behandle Zeitzonen und Datumsgrenzen eindeutig (reine Datumswerte ohne Uhrzeitverschiebung); der Stichtag ist ein expliziter Parameter.
- Entferne den stillen Fallback von Brutto auf Netto. Falls ein Fallback fachlich gewünscht ist, ist er in der Oberfläche eindeutig zu kennzeichnen.
- Ergänze in Kostenplan und Kopfkarte eine Kennzeichnung der Basis (brutto/netto) und gegebenenfalls eine Umschaltmöglichkeit.
- Korrigiere die Labels (Umlaute, Rechtschreibung) und vereinheitliche das Datumsformat über die gesamte Kostenansicht.
- Korrigiere die Statuslogik und dokumentiere sie.
- Bestehende Daten dürfen durch die Korrektur nicht verändert werden. Falls Bruttowerte nachträglich berechnet werden sollen, ist dies eine bewusste, separat beschriebene Migration.

## Tests

### Unit-Tests

- Drei Kostenpositionen wie im Beispiel: Kostenplan enthält alle vergangenen und projizierten Zeiträume, „Bisher gezahlt" ist die korrekte Summe.
- Preisänderung innerhalb eines Abrechnungszeitraums.
- Lücken und Überlappungen zwischen Kostenpositionen.
- Position ohne Ende („gültig bis" leer) und Position, die erst in der Zukunft beginnt.
- Alle Frequenzen: monatlich, vierteljährlich, halbjährlich, jährlich.
- Nur Netto erfasst, nur Brutto erfasst, beide erfasst: kein stiller Fallback, korrekte Summen je Basis.
- Stichtagsgrenzen (Zeitraumbeginn und -ende exakt am Stichtag, Schaltjahr).
- Rundung bei Cent-Beträgen.

### Integrations- und UI-Tests

- Kostenansicht mit dem Beispieldatensatz zeigt vollständigen Kostenplan und korrekte Summen.
- Korrekte Umlaute und einheitliches Datumsformat.
- Brutto/Netto-Anzeige bei fehlendem Bruttowert.
- Ansicht auf Smartphone und Tablet bleibt lesbar.

## Akzeptanzkriterien

- Der Kostenplan enthält alle vergangenen Zeiträume seit der ersten Kostenposition.
- „Bisher gezahlt" entspricht der Summe aller bis zum Stichtag angefallenen Zeiträume.
- Brutto und Netto werden getrennt geführt und nie stillschweigend vertauscht.
- Alle Beträge, Spalten und Summen nennen ihre Basis.
- Texte (Umlaute, Rechtschreibung) und Datumsformate sind korrekt und einheitlich.
- Die festgelegte Fachlogik ist dokumentiert und durch Tests abgesichert.
- Bestehende Kostendaten bleiben unverändert.

## Priorität

Hoch: Die angezeigten Summen sind fachlich falsch und können zu Fehlentscheidungen führen.

## Abschlusslieferung

1. Ursachenanalyse mit betroffenen Dateien und Funktionen.
2. Korrektur der Berechnungslogik und Anzeige.
3. Automatisierte Tests einschließlich des Beispieldatensatzes.
4. Dokumentation der festgelegten Fachregeln (Zeiträume, Brutto/Netto, Status).
5. Liste geänderter Dateien mit kurzer Begründung.
6. Offene Fachfragen und Einschränkungen, klar getrennt von abgeschlossenen Arbeiten.

Behaupte keine Testergebnisse, die nicht tatsächlich ausgeführt wurden.
