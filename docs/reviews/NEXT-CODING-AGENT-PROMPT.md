# Nächster Agent: AP-15-docker-compose-delivery-baseline

Führe in der nächsten Coding-Agent-Session ausschließlich AP-15 aus. **Die geplante Reihenfolge ist bewusst abweichend von der Nummerierung: AP-15, danach AP-14, danach AP-13, anschließend die reguläre numerische Folge ab AP-11.**

---

```text
Du implementierst AP-15 im Projekt Insura.

## Work Package: AP-15-docker-compose-delivery-baseline

Ziel: Insura muss nach dieser und jeder künftigen Änderung aus einem frischen Clone zuverlässig mit `docker compose up --build` als vollständiger, nutzbarer Stack laufen.

Verbindliche Referenzen:
- `/AGENTS.md`
- `/prompts/00-gemeinsame-regeln.md`
- Alle Dokumente unter `/docs`, insbesondere Architektur, Security/Privacy, Admin Operations, UI/UX, Dependency Policy und ADRs
- Bestehende `Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`, `.env.example`, CI-Workflows, Prisma-Konfiguration sowie Start- und Health-Check-Code

Arbeite in einem neuen Branch `feat/AP-15-docker-compose-delivery-baseline` auf Basis des aktuellen `main`. Direkte Änderungen an `main` sind verboten.

Aufgabe:
Implementiere die Docker-Compose-Delivery-Baseline als vollständigen vertikalen Slice.

Akzeptanzkriterien:
- `docker compose up --build` startet aus einem frischen Clone mit dokumentierter Umgebung einen nutzbaren Stack aus Web, API, Worker, PostgreSQL, Redis und allen tatsächlich erforderlichen Diensten.
- Container kommunizieren ausschließlich über Compose-Netzwerk und dokumentierte Konfiguration; interne Ports werden nicht unnötig veröffentlicht.
- Datenbankmigrationen laufen idempotent und vor der Nutzung abhängiger Anwendungsfunktionen; Anwendungen starten nicht gegen eine nicht migrierte Datenbank.
- Health Checks prüfen echte Readiness ohne beliebige Sleep-Delays. Startreihenfolge, Restarts und persistente Volumes sind zuverlässig.
- Erforderliche persistente Daten, einschließlich Uploads falls bereits lokal gespeichert, verwenden benannte Volumes und sind dokumentiert.
- `.env.example`, README und Operations-Dokumentation enthalten vollständige, sichere Konfigurations-, Start-, Stop-, Log-, Reset-, Backup- und Troubleshooting-Hinweise. Keine Secrets, Credentials oder host-spezifischen Pfade werden committed oder in Images eingebrannt.
- Es gibt einen wiederholbaren Compose-Smoke-Test für Build, Readiness, API Health, Web-Verfügbarkeit und mindestens einen dependency-gestützten Request. Wenn CI Container ausführen kann, ist dieser Test in CI integriert und liefert Logs bei Fehlern.
- Die Repository-Guidance enthält verbindlich: Jede künftige Änderung muss `docker compose up --build` aus einem frischen Clone funktionsfähig halten und neue Dienste, Migrationen, Umgebungsvariablen, Queues, Volumes, Ports oder Health Checks im selben Feature in Compose, `.env.example`, Dokumentation und Smoke-Test ergänzen.
- Bestehende Funktionalität, Sicherheitsgrenzen, Linting, Typecheck, Tests und Production Build bleiben intakt.

Nicht-Ziele:
- Kein Kubernetes, Terraform, Cloud-Vendor-Deployment, Image-Registry-Publishing oder spekulative Infrastruktur, sofern bestehende Anforderungen dies nicht ausdrücklich verlangen.
- Keine Änderung von Fachlogik außer für sicheren Startup, Konfigurationsvalidierung, Migrationen, Health oder Storage.

Vorgehen:
1. Gib zunächst ausschließlich Ziel, technische Lösung, Architekturentscheidung, betroffene Dateien, neue Abhängigkeiten samt Maintenance-Prüfung, Risiken und Testplan aus.
2. Warte auf ausdrückliche Freigabe zur Implementierung.
3. Implementiere danach nur AP-15. Halte Feature-Grenzen strikt ein.
4. Verifiziere den Stack aus sauberem Zustand, nicht nur gegen vorhandene Images, Volumes oder Datenbanken.
5. Führe Formatierung, Linting, Typecheck, Unit-Tests, Integrations-/E2E-Tests, Production Build, Migrationsprüfung und Compose-Smoke-Test aus, soweit im Projekt verfügbar.
6. Aktualisiere vor dem finalen Testlauf den Branch mit dem aktuellen `main`.
7. Öffne einen Pull Request gegen `main`; niemals selbst mergen.

PR-Titel:
`feat(AP-15): docker-compose-delivery-baseline`

PR-Beschreibung muss enthalten:
- Zweck, Service-Topologie sowie Architekturentscheidung
- Liste geänderter Dateien
- Ports, Volumes, Health Checks, Migrations- und Startup-Reihenfolge
- Vollständige Konfigurationsmatrix ohne Secret-Werte
- Nachweis aller Akzeptanzkriterien
- Ausgeführte Befehle und Ergebnisse, einschließlich Clean-Start und Compose-Smoke-Test
- Neue Abhängigkeiten mit Maintenance-Prüfung
- Sicherheits- und Datenschutzbewertung
- Bekannte Grenzen oder bewusst nicht umgesetzte Teilfunktionen

Merge-Gate:
Der Pull Request darf nur nach erfolgreich bestandenem Funktionstest, grüner CI, aktuellem `main` im Branch und unabhängigem Review gemergt werden. Wenn ein Check fehlschlägt, behebe ihn im selben Branch und aktualisiere den Pull Request.
```

### Wichtige Anweisungen

1. **Implementiere NUR AP-15.** AP-14 und AP-13 dürfen noch nicht begonnen werden.
2. **Verwende denselben Review-Loop** wie in `AGENTS.md` beschrieben:
   - Implementieren → Checks laufen lassen → `@code-reviewer` aufrufen → Review-Ergebnis in `docs/reviews/` speichern → Findings fixen → erneut reviewen → bei Akzeptanz committen.
   - Akzeptanzbedingung: 0 Critical, 0 High, 0 Medium, ≤8 Minor.
3. **Starte in einem neuen Branch** `feat/AP-15-docker-compose-delivery-baseline` auf Basis von `main`.
4. **Nach erfolgreichem Commit** erstelle diese Datei als nächsten Auftrag für `prompts/AP-14-local-username-password-login.md`. Nach AP-14 folgt AP-13; nach AP-13 wird mit AP-16 und anschließend in normaler aufsteigender Nummerierung fortgesetzt. Danach stoppen.

## Basis-Wissen

- Distrobox `fedora-app` für alle CLI-Befehle: `distrobox enter fedora-app -- <command>`
- PostgreSQL läuft in der Distrobox. Dev-Server: `distrobox enter fedora-app -- bash -c "pnpm run dev"`
- Alle relevanten Checks: lint, typecheck, test (API: vitest, Worker: vitest)
- Prisma: `distrobox enter fedora-app -- bash -c "CI=true pnpm --filter @insura/api exec prisma generate"`
- CI=true verhindert interaktive Nachfragen bei pnpm
