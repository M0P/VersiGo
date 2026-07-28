# Gemeinsame Ausführungsregeln

Diese Datei ist für jedes Arbeitspaket verbindlich.

- Arbeite ausschließlich auf einem neuen Branch vom aktuellen `main`.
- Branch-Schema: `feat/AP-XX-kurzbezeichnung`; für Korrekturen `fix/AP-XX-kurzbezeichnung`.
- Erstelle keinen direkten Commit auf `main`.
- Öffne nach der Umsetzung einen Pull Request gegen `main`.
- Merge ist verboten, bevor alle lokalen und CI-Tests erfolgreich sind.
- Rebase oder merge den aktuellen `main` in den Arbeitsbranch unmittelbar vor dem finalen Testlauf.
- Der Pull Request darf erst gemergt werden, wenn alle erforderlichen Statuschecks grün sind, die Akzeptanzkriterien erfüllt sind und ein Review durchgeführt wurde.
- Ein Modell darf seinen eigenen Pull Request nicht freigeben oder mergen. Der finale Merge erfolgt durch einen separaten Reviewer oder einen Menschen.
- Halte die Dokumentation unter `/docs` verbindlich ein, insbesondere ADRs, Sicherheitsanforderungen und die Bibliothekspolitik.
- Nutze keine neue Abhängigkeit ohne dokumentierte Maintenance-Prüfung gemäß `docs/10-quality-and-library-policy.md`.
- Kein Secret in Code, Commit, Testdaten, Screenshot oder Log.
- Jede Änderung benötigt passende Tests.

## Lokale Entwicklungsdienste ohne Docker

Für Umgebungen ohne Docker (z. B. Distrobox/Bazzite-Setups ohne systemd als
PID 1) steht `scripts/dev-services.sh` bereit, um PostgreSQL und Redis/Valkey
manuell zu starten, zu stoppen und deren Status zu prüfen:

```bash
./scripts/dev-services.sh start
./scripts/dev-services.sh status
./scripts/dev-services.sh stop
```

Voraussetzung: PostgreSQL und Valkey (Redis-kompatibel) sind lokal installiert
und `PGDATA` wurde bereits via `initdb` initialisiert. Agenten und
Entwickler, die lokale Datenbank-Setups einrichten oder Migrationen ausführen,
sollen dieses Skript nutzen bzw. erweitern, statt eigene Ad-hoc-Startbefehle
zu erfinden. Docker Compose bleibt der bevorzugte Weg für alle Umgebungen, in
denen Docker verfügbar ist; dieses Skript ist ausschließlich der Fallback für
Docker-lose lokale Entwicklungsumgebungen.

## Standardablauf

1. `git checkout main && git pull --ff-only`
2. Branch anlegen und pushen.
3. Betroffene Dateien, Design und Risiken im PR beschreiben.
4. Implementieren, formatieren, linten, testen und dokumentieren.
5. Aktuellen `main` integrieren, vollständige Tests erneut ausführen.
6. Pull Request mit Checkliste öffnen.
7. Erst nach erfolgreichem unabhängigen Review und grüner CI mergen lassen.

## Pflichtausgabe des Modells

Vor jeder Implementierung: Ziel, Architekturentscheidung, Dateiliste, Abhängigkeiten, Risiken und Testplan. Nach der Implementierung: geänderte Dateien, ausgeführte Befehle, Testergebnisse, bekannte Grenzen und PR-Beschreibung.
