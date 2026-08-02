# Arbeitspaket AP-09: ai-assist

## Ziel
Optionale AI-Provider-Adapter, asynchrone Vertragsdatenextraktion und Job-Monitoring.

## Prompt für das Umsetzungsmodell

```text
Du implementierst AP-09 im Projekt VersiGo.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit und Bibliothekspolitik

Arbeite in einem neuen Branch `feat/AP-09-ai-assist` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Optionale AI-Provider-Adapter, asynchrone Vertragsdatenextraktion und Job-Monitoring.

Akzeptanzkriterien:
- Ollama und OpenAI-kompatible Provider sind über ein gemeinsames Interface anbindbar.
- AI-Jobs laufen asynchron und sind retryfähig.
- AI-Ausfall blockiert weder Vertrags- noch Dokumentenverwaltung.
- Extrahierte Daten enthalten Quelle, Konfidenz und Übernahme-Workflow.
- Dokumente können von AI-Verarbeitung ausgeschlossen werden.

Vorgehen:
1. Gib zunächst ausschließlich Ziel, technische Lösung, Architekturentscheidung, betroffene Dateien, neue Abhängigkeiten samt Maintenance-Prüfung, Risiken und Testplan aus.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Halte Feature-Grenzen strikt ein.
4. Führe Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests und Build aus, soweit im Projekt verfügbar.
5. Aktualisiere vor dem finalen Testlauf den Branch mit dem aktuellen `main`.
6. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-09): ai-assist`

PR-Beschreibung muss enthalten:
- Zweck und Architekturentscheidung
- Liste geänderter Dateien
- Nachweis aller Akzeptanzkriterien
- Ausgeführte Befehle und Ergebnisse
- Neue Abhängigkeiten mit Maintenance-Prüfung
- Sicherheits- und Datenschutzbewertung
- Bekannte Grenzen oder bewusst nicht umgesetzte Teilfunktionen

Merge-Gate:
Der Pull Request darf nur nach erfolgreich bestandenem Funktionstest, grüner CI, aktuellem `main` im Branch und unabhängigem Review gemergt werden. Wenn ein Check fehlschlägt, behebe ihn im selben Branch und aktualisiere den Pull Request.
```
