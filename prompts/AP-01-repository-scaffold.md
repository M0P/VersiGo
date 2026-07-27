# Arbeitspaket AP-01: repository-scaffold

## Ziel
Repository-Scaffold, Monorepo-Grundstruktur, Docker Compose, PostgreSQL, Redis, Konfigurationsrahmen, CI-Grundgerüst und leere vertikale Feature-Slices.

## Prompt für das Umsetzungsmodell

```text
Du implementierst AP-01 im Projekt Insura.

Verbindliche Referenzen:
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur-ADRs, Sicherheit und Bibliothekspolitik

Arbeite in einem neuen Branch `feat/AP-01-repository-scaffold` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Repository-Scaffold, Monorepo-Grundstruktur, Docker Compose, PostgreSQL, Redis, Konfigurationsrahmen, CI-Grundgerüst und leere vertikale Feature-Slices.

Akzeptanzkriterien:
- Monorepo-Struktur folgt `docs/09-ai-agent-implementation-plan.md`.
- Docker Compose startet Web, API, Worker, PostgreSQL und Redis reproduzierbar.
- Konfiguration enthält keine produktiven Secrets und benötigt nur dokumentierte Bootstrap-Variablen.
- CI führt mindestens Format, Lint, Typecheck, Unit-Tests und Build aus.
- Leere Slices sind ohne fachliche Querimporte angelegt.

Vorgehen:
1. Gib zunächst ausschließlich Ziel, technische Lösung, Architekturentscheidung, betroffene Dateien, neue Abhängigkeiten samt Maintenance-Prüfung, Risiken und Testplan aus.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur dieses Arbeitspaket. Halte Feature-Grenzen strikt ein.
4. Führe Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests und Build aus, soweit im Projekt verfügbar.
5. Aktualisiere vor dem finalen Testlauf den Branch mit dem aktuellen `main`.
6. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-01): repository-scaffold`

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
