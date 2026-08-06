# BugFix-06: Release-Verifikation Docker (BugFix-04/05), Paperless/SSRF-Lockerung (lokale Endpunkte, selbst signierte Zertifikate), Kosten-Fixes & Kosten-Tabelle, Feature-Flag-Neustart, Dashboard-Pinning, Englische Doku, Endanwender-Deployment & Release-Guide

## Kontext

BugFix-04 (Commit `09e680b`) hat die Docker-Images verkleinert (API 839→493 MB, Worker 828→488 MB, Web 241→206 MB) und BugFix-05 (Commit `e1ca357` + `eb855ac`) hat den Docker-Produktions-Build von api/worker repariert sowie die manuellen Test-Befunde 1–9 umgesetzt (Feature-Konfiguration, Portal-URL-Normalisierung, Kosten je Versicherung, Spinner, Signout, Tab-Reload, Family-Sharing).

Dieses Arbeitspaket erweitert den ursprünglichen BugFix-06-Umfang (reine Docker-Release-Verifikation) um die folgenden, beim manuellen Betrieb aufgefallenen Themen: Paperless-Connectivity (SSRF-Guard blockiert lokale Endpunkte, selbst signierte Zertifikate), ein Kosten-UI-Bug, die Kosten-Berechnung gemäß Abrechnungszeitraum, ein Neustart-Feature für Funktionen mit Boot-Abhängigkeiten, eine tabellarische Kosten-Übersicht, das Dashboard-Pinning von Versicherungen, die Umstellung der gesamten Dokumentation auf Englisch, die Endanwender-Optimierung des Docker-Compose-Deployments und eine Schritt-für-Schritt-Anleitung zum Veröffentlichen der Software als Container-Image.

**WICHTIG — NEUER BRANCH:** Diese Session startet auf einem **neuen Branch** vom aktuellen `main` (Branch-Schema gemäß `prompts/00-gemeinsame-regeln.md`: `fix/BugFix-06-<kurzbezeichnung>`). Es wird **nicht** auf `fix/BugFix-02-manual-test-findings` weitergearbeitet und kein direkter Commit auf `main` erstellt. Nach Abschluss wird ein Pull Request gegen `main` geöffnet (Merge durch separaten Reviewer/Menschen, nicht durch das Modell).

---

## Verbindliche Regeln (gelten für das gesamte Arbeitspaket)

1. **Scope-Rule:** Implementiere ausschließlich dieses Arbeitspaket. Starte kein späteres Arbeitspaket und erweitere den Umfang nicht ohne explizite Anweisung.
2. **Review-Loop (Pflicht):** Nach der Implementierung wird `@code-reviewer` (DeepSeek code-reviewer) über die uncommitteten Änderungen laufen gelassen – gegen das Arbeitspaket, Projektkonventionen, Korrektheit/Regressionen, Sicherheit, Tests, Wartbarkeit. Das Ergebnis wird **wörtlich** nach `docs/reviews/BugFix-06-review-<n>.md` geschrieben (`docs/reviews` anlegen, falls fehlend). Fix alle Critical/High/Medium-Findings (Minor, wenn sinnvoll) und wiederhole die Runde. **Abbruchbedingung:** 0 Critical / 0 High / 0 Medium, höchstens 8 Minor, relevante automatische Checks grün (oder Abweichung dokumentiert). Maximal 5 Review-Runden; danach stoppen, berichten und den Nutzer entscheiden lassen. Ein Review ist nur gültig, wenn die Task-Tool-Invocation des `code-reviewer` erfolgreich abgeschlossen wurde.
3. **Docker Compose ist die primäre und verbindliche Umgebung.** Alle Prüfungen (Lint, Typecheck, Unit/Integration, Smoke, Migrationen, Build) laufen in Containern.
   - Kanonischer Testbefehl: `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test`
   - Kanonischer Smoke-Test: `./scripts/compose-smoke-test.sh --build`
   - **Podman-Pitfall:** vor jedem `up --build` immer `docker compose -f docker-compose.test.yml down -v` (podman-compose pinnt bestehende Container auf alte Image-IDs). Bei Bedarf Container-Image per `podman inspect` verifizieren.
4. **Required Future-Feature Contract:** Jede neue Runtime-Abhängigkeit, Env-Variable, Migration, Queue, Storage-Pfad, Port, Health-Endpunkt oder Dienst wird **im selben Paket** in Compose, `.env.example`, Dokumentation und Compose-Smoke-Test ergänzt. Nach dem Paket muss `docker compose up --build` aus einem frischen Clone funktionieren.
5. **Kein `rg`** – nur grep. ESLint-Regel `react-hooks/exhaustive-deps` ist NICHT registriert (disable-Kommentare wären Lint-Fehler; stattdessen erklärende Kommentare verwenden).
6. **Keine Secrets** in Code, Commit, Testdaten, Screenshots oder Logs. Keine `.env`-Dateien committen.
7. **Aufräum-Pflicht am Ende** (AGENTS.md Regeln 9–11): alle während der Session erzeugten Docker/Podman-Artefakte entfernen (Debug-/Wegwerf-Container, Build-/Test-Images der Session inkl. `localhost/versigo-test:latest`, verwaiste Images, Scratch-Volumes, `docker compose down -v`). **Nicht** entfernen: gemeinsame Basis-Images (node, postgres, redis, ...) und Container, die vor der Session liefen. Keine Scratch-Dateien außerhalb des Repos hinterlassen (`podman unshare rm -rf` bei Root-Eigentum). Abschließend `podman ps -a`, `podman images`, `df -h` verifizieren.
8. **Tests:** Jede Änderung benötigt passende Tests (Unit/Integration im Docker-Compose-Testpfad).
9. **Pflichtausgabe:** Vor der Implementierung Ziel, Architekturentscheidung, Dateiliste, Abhängigkeiten, Risiken und Testplan; nach der Implementierung geänderte Dateien, ausgeführte Befehle, Testergebnisse, bekannte Grenzen, PR-Beschreibung.

---

## Teil 1: Docker-Release-Verifikation (bestehender Umfang von BugFix-06)

1. **Fresh-Clone-Compose:** In einem frischen Arbeitsverzeichnis (git clone bzw. `git clean -fdx`-äquivalenter Zustand, kein `node_modules`, keine alten Volumes):
   - `cp .env.example .env` (mit gültigen Platzhalterwerten für lokale Entwicklung)
   - `docker compose down -v` (Altlasten entfernen)
   - `docker compose up --build` → alle Services starten: db, redis, migration (one-shot, läuft durch), api, worker, web.
   - Healthchecks werden `healthy`: api `/health` 200 (Port 3001), web 2xx/3xx (Port 3000), worker Liveness (3100, nur im Container).
   - Login mit dem initialen lokalen Administrator funktioniert.
2. **Compose-Smoke-Test:** `./scripts/compose-smoke-test.sh --build` läuft komplett durch (alle 12 Schritte, inkl. Produktions-Erfolgspfad).
3. **CI-Build-Szenario (BugFix-05-Regression):** `docker compose build api web worker` läuft fehlerfrei – zusätzlich einmal **kalt** (`--no-cache`) für api/worker, um die Store-Race-Variante (TS2307 in `@versigo/foundation:build`) auszuschließen.
4. **Image-Größen (Zielwerte aus BugFix-04):** `api ≤ 520 MB`, `worker ≤ 520 MB`, `web ≤ 230 MB` (`podman image ls` / `docker image ls`; geprüft nach `docker compose build`).
5. **Voller Test-Gate:** `docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test` → grün (Lint, Typecheck, Unit/Integration, i18n-Guard, Turbo 5/5).
6. **Dokumentation:** `docs/docker-image-guide.md` spiegelt den Ist-Stand (Befehle, Ports, Image-Größen, Hinweis auf den Cache-Store je Service). Bei Abweichungen dokumentieren/korrigieren.
7. **Keine offenen Docker-Bauchschmerzen:** `.dockerignore` deckt `node_modules/`, `.env*`, `.git` ab; keine `.env`-Datei im Image (Prüfung: `podman run --rm --entrypoint sh <image> -c 'ls -la /app | grep -c .env'` liefert 0 Treffer).

## Teil 2: Paperless-Connectivity / SSRF-Guard – lokale Endpunkte & selbst signierte Zertifikate erlaubbar machen

### Fehlerbild (vom Nutzer beobachtet)

Der Connectivity-Test (Admin-Einstellungen, `POST /admin/connectivity-test`, Guard `apps/api/src/common/connectivity/connectivity-guard.ts`) lehnt lokale/private Paperless-Endpunkte ab:

- `Endpunkt aus Sicherheitsgruenden abgelehnt: Hostname 'papierkram.home' loest auf eine gesperrte Adresse auf (lokal/privat/metadata) – der Connectivity-Test erlaubt aus SSRF-Schutz nur oeffentliche http(s)-Endpunkte; lokale Dienste (z. B. Ollama unter localhost) pruefen Sie bitte direkt auf dem Host.`
- `Endpunkt aus Sicherheitsgruenden abgelehnt: Adresse '192.168.24.8' liegt in einem gesperrten Bereich (lokal/privat/metadata) – der Connectivity-Test erlaubt aus SSRF-Schutz nur oeffentliche http(s)-Endpunkte; lokale Dienste (z. B. Ollama unter localhost) pruefen Sie bitte direkt auf dem Host.`
- Effektiver Wert des Nutzers: `http://192.168.24.8:8010`

### Anforderungen

1. **Lokale IP-Adressen mit `http` erlauben:** In den Admin-Einstellungen muss der Connectivity-Test (Paperless/Storage) auch gegen lokale Endpunkte laufen können:
   - Private IPv4/IPv6-Adressen (RFC-1918: 10/8, 172.16/12, 192.168/16, CGNAT 100.64/10, Loopback 127/8, Link-Local 169.254/16) und lokale Hostnamen (`localhost`, `*.local`, `*.home`, `*.internal`, …).
   - Entweder als Admin-Einstellung (Settings-Catalog-Schlüssel, z. B. `PAPERLESS_ALLOW_LOCAL_ENDPOINTS` bzw. generisch für den Connectivity-Test) mit sicherem Default (Standard: **deaktiviert** = bisheriges Verhalten) ODER eine konfigurierbare Erlaubnis-Liste/`ALLOW_PRIVATE_ENDPOINTS=true`-Env-Option. Der Nutzer soll die Option explizit aktivieren können, ohne dass der SSRF-Schutz komplett ausgehebelt wird (Metadata-Adresse 169.254.169.254 muss auch dann gesperrt bleiben).
   - Der Guard (`connectivity-guard.ts`) muss dafür um eine explizite Opt-in-Prüfung erweitert werden; die Block-Liste für Cloud-Metadata und der generelle SSRF-Schutz bleiben bestehen, wenn die Option nicht gesetzt ist.
2. **Selbst signierte Zertifikate erlaubbar machen:** Eine Admin-Einstellung (z. B. `ALLOW_INSECURE_TLS`/`CONNECTIVITY_ALLOW_SELF_SIGNED`), die bei HTTPS-Endpunkten mit selbst signierten/ungenügenden Zertifikaten das TLS-Validierungs-Fehlschlagen verhindert (Fetch mit `NODE_TLS_REJECT_UNAUTHORIZED=0`-Äquivalent bzw. `rejectUnauthorized: false` nur für den Connectivity-Test, sichere Defaults).
3. **Ebenso alles Lokale für OIDC- und AI-Endpunkte erlauben:** Die gleiche Lockerung (lokale/private Adressen + ggf. selbst signierte Zertifikate) muss auch für
   - **OIDC-Endpunkte** (Issuer-URL `OIDC_ISSUER_URL`, Discovery/Callback) und
   - **AI-Endpunkte** (`AI_OLLAMA_BASE_URL`, `AI_OPENAI_COMPAT_BASE_URL`, `AI_EXTRACTION_TIMEOUT_MS`-bezogene Fetch-Aufrufe, z. B. Ollama unter localhost)
   anwendbar sein. Zielbild: Ein Endanwender, der Paperless-ngx auf `http://192.168.24.8:8010`, Ollama auf `http://localhost:11434` oder einen OIDC-Provider im LAN betreibt, kann diese über die UI konfigurieren und der Connectivity-Test schlägt nicht mehr aus SSRF-Gründen fehl – jeweils hinter der explizit aktivierten Einstellung mit dokumentiertem Sicherheitshinweis in der UI.
4. **Tests & Doku:** Guard-Spec (`connectivity-guard.spec.ts`) um die neuen Optionen erweitern (aktiv → lokale Endpunkte erlaubt, Metadata bleibt gesperrt; inaktiv → bisheriges Verhalten). i18n-Texte (de/en) für neue Einstellungen und Hinweise ergänzen; `.env.example`, Settings-Catalog (`packages/foundation/src/config/settings-catalog.ts`) und Doku aktualisieren. **Hinweis:** Sicherheitsverhalten bewusst erhalten – der Default bleibt strikt (nur öffentliche Endpunkte), die Lockerung ist explizit opt-in.

## Teil 3: Kosten – Bugfix & Berechnung nach Abrechnungszeitraum

1. **Bug: Bestehende Kostenkonfigurationen einer Versicherung lassen sich nicht mehr über die UI bearbeiten/löschen.** Reproduktion und Behebung: In der Kosten-Konfiguration einer Versicherung (Tab/Seite Kosten) müssen bestehende Einträge (Kostenart, Betrag, Zeitraum/Frequenz) weiterhin editierbar und löschbar sein. Dabei gelten die etablierten Sequenz-Schutzmuster (kein `setState` nach `await` auf veraltete Requests, Laden/Erfolgs-/Fehlerpfad abgesichert).
2. **Verbesserung: Bisher gezahlte Kosten nicht auf Tagesbasis berechnen, sondern entsprechend dem Abrechnungszeitraum der Versicherung.** Die Berechnung bisher gezahlter Kosten muss den Abrechnungszeitraum der Versicherung (Zahlungsfrequenz, z. B. monatlich/quartalsweise/jährlich gemäß `paymentFrequency`) berücksichtigen statt linearer Tagesanteile. Konsistenz mit den vorhandenen Kosten-Endpunkten (`cost-tracking.controller.ts`: overview/annual/compare, `cost-tracking.service.ts`) herstellen.
3. **Neues Feature: Gezahlte Kosten tabellarisch seit Beginn der Versicherung bis heute auflisten** (gemäß der Abrechnungsperioden): Tabelle mit Perioden (z. B. 01/2024, 02/2024, …), fälligem Betrag je Periode, gezahltem Betrag, Status/Abweichung – von `startDate` der Versicherung bis heute. API-Endpunkt (z. B. `GET .../costs/paid-history` bzw. Erweiterung der bestehenden Kosten-Route) + UI-Tabelle (Responsive, i18n de/en) + Tests.
4. **Feature-Flags: Neustart über die UI anbieten.** Funktionen, deren Änderung einen Neustart von api/worker erfordern (z. B. OIDC-Bootstrap, Env-/Settings-Kategorien, die nur beim Boot gelesen werden), müssen in der UI kenntlich gemacht werden („Neustart erforderlich") und es muss ein **Neustart über die UI** angeboten werden (z. B. Admin-Aktion „Dienste neu starten": Post-Request an einen geschützten Admin-Endpunkt, der Container/Prozesse kontrolliert neu startet bzw. einen sauberen Restart anstößt). Sichere Umsetzung (nur Admin, keine Secrets im Log, klare Bestätigung in der UI), i18n de/en, Doku.

## Teil 4: Dashboard-Pinning

**Neues Feature:** Versicherungen können an das Dashboard angepinnt werden und werden dann dort immer direkt angezeigt (Pinn-Badge/Auswahl je Versicherung, persistente Speicherung, Dashboard-Kachel/Karte pro angepinntem Vertrag mit Kerninformationen wie Anbieter, Tarif, Vertragsnummer, nächste Fälligkeit, Kosten-Zusammenfassung). Persistenz im bestehenden Datenmodell ergänzen (z. B. `pinnedAt`-Feld auf `insurance_policies` via Migration oder Nutzer-Präferenzen), API (Liste angepinnte Verträge, Pinn-/Unpinn-Endpunkt) + UI (Dashboard + Pinn-Aktion in der Vertragsliste/Detailansicht) + i18n de/en + Tests. Bestehende Dashboard-Struktur (`apps/web/src/app/(dashboard)` bzw. vorhandene Dashboard-Seite) prüfen und erweitern.

## Teil 5: Dokumentation komplett auf Englisch

**Umfang:** Ändere **jegliche Projektdoku** – sowohl im Code (Kommentare, Doc-Strings, JSDoc, READMEs, ADRs unter `docs/`, `AGENTS.md`, `prompts/00-gemeinsame-regeln.md`, Work-Package-Prompts) als auch außerhalb (Web-UI-Texte sind bereits i18n-getrennt; prüfen, dass de/en vollständig gepflegt sind) – auf **Englisch**. Deutschsprachige Kommentare, Doku und Prompt-Dateien übersetzen. **Achtung: keine Funktionsänderungen**, keine Bezeichner-Umbenennungen (Variablen/Funktionen/Klassen bleiben), keine Log-Nachrichten/API-Fehlertexte ändern, die von Tests referenziert werden (bzw. Tests konsistent anpassen). Scope-Disziplin: reine Übersetzungs-/Doku-Aufgabe.

## Teil 6: Endanwender-Deployment via Docker Compose optimieren

Das Projekt soll für Endanwender so einfach wie möglich per `docker compose` deployed werden können. Dafür ist alles Notwendige umzusetzen – technisch wie fachlich/dokumentarisch:

1. **Technisch:** `.env.example` mit allen Variablen inkl. verständlicher Kommentare; `docker-compose.yml` mit sinnvollen Defaults für einen Endanwender-Betrieb (Ports, Volumes, Healthchecks, Restart-Policy); offizielle Images/Konfiguration, die ohne Expertenwissen starten (z. B. Default-Setup, bei dem `docker compose up --build` eine lauffähige Instanz erzeugt); `AGENTS.md` „Required Future-Feature Contract" beachten.
2. **Fachlich/Doku:** Eine **Endanwender-Anleitung** (englisch, nach Teil 5) unter `docs/`, die Schritt für Schritt beschreibt: Voraussetzungen, `.env` anlegen, `docker compose up --build`, Login mit initialem Administrator, erste Schritte, Backup/Wiederherstellung der Volumes, Updates. Kompakt, verständlich, ohne Entwicklungswissen.
3. **Verifikation:** Der frische-Clone-Durchlauf aus Teil 1 gilt als Nachweis für die Endanwender-Lauffähigkeit.

## Teil 7: Schritt-für-Schritt-Anleitung zum Veröffentlichen als fertiges Container-Image

**Zuletzt** (Ergebnis-Dokument, englisch): Dem verantwortlichen Nutzer eine **Schritt-für-Schritt-Anleitung** liefern, wie die Software als fertiges (Release-)Container-Image veröffentlicht wird. Inhalt:
- Lokal bauen und verifizieren (`docker compose build api web worker`, Smoke-Test, Test-Gate, Image-Größen).
- Image-Tagging/Versionierung (SemVer/Commit, `podman build -t ...` / `docker build -t ...`, Tag `localhost/versigo-*:latest` → Release-Tag).
- Optional: Veröffentlichung auf einer Registry (z. B. Docker Hub/GHCR) mit Schritt-für-Schritt-Kommandos (Login, `push`, ggf. Multi-Arch-Hinweis), inkl. Hinweis auf die Registry-Konfiguration in `docker-compose.yml` (Image-Referenz austauschbar).
- Wie ein Endanwender das Release-Image nutzt (`docker compose` mit Image-Referenz statt Build).
- Sicherheits-/Release-Checks (keine `.env` im Image, Secrets sauber, Tag/Changelog/Doku-Update).
- Ablage als `docs/release-guide.md` (englisch) und Kurzfassung im Endanwender-Guide (Teil 6).

---

## Akzeptanzkriterien

- Teil 1: `docker compose up --build` startet den kompletten Stack aus einem frischen Clone fehlerfrei (alle Services `healthy`, Web http://localhost:3000, API http://localhost:3001). `scripts/compose-smoke-test.sh --build` grün (12/12). `docker compose build api web worker` sowie Kalt-Builds (`--no-cache`) für api/worker grün ohne TS2307. Image-Größen: api ≤ 520 MB, worker ≤ 520 MB, web ≤ 230 MB. Volles Test-Gate grün. Keine `.env`-Dateien/Host-`node_modules` im Image.
- Teil 2: Connectivity-Test gegen lokale/private http(s)-Endpunkte (z. B. `http://192.168.24.8:8010`, `http://localhost:11434`) funktioniert, wenn die neue Einstellung aktiviert ist; Cloud-Metadata bleibt gesperrt; Standardverhalten (ohne Aktivierung) unverändert strikt; selbst signierte Zertifikate bei aktivierter Option toleriert; OIDC- und AI-Endpunkte profitieren von der gleichen Lockerung. Tests grün, i18n vollständig.
- Teil 3: Kosten-Konfigurationen wieder bearbeit-/löschbar; Berechnung erfolgt nach Abrechnungszeitraum (nicht tagesanteilig); neue tabellarische Kosten-Übersicht (Versicherungsbeginn → heute) mit API, UI und Tests; Neustart-über-UI-Feature für boot-relevante Einstellungen vorhanden (nur Admin, dokumentiert).
- Teil 4: Versicherungen können über die UI angepinnt werden und erscheinen persistent auf dem Dashboard; API, UI, Migration, i18n de/en, Tests.
- Teil 5: Projektdoku (Code + außerhalb) vollständig auf Englisch, keine Funktionsänderungen.
- Teil 6: Endanwender-Deployment funktioniert per `docker compose` aus einem frischen Clone mit `.env.example`-Werten; Endanwender-Anleitung (englisch) unter `docs/`.
- Teil 7: `docs/release-guide.md` (englisch) mit Schritt-für-Schritt-Anleitung zum Veröffentlichen als Container-Image (Build, Tag, Registry-Push, Nutzung durch Endanwender, Release-Checks).
- Review-Loop: 0 Critical / 0 High / 0 Medium, ≤ 8 Minor; alle Pflicht-Checks grün oder Abweichung dokumentiert. Neue Branch-Anforderung eingehalten (kein Commit auf `main`/Alt-Branch), am Ende PR gegen `main`.

## Nächste Schritte

1. Neuen Branch `fix/BugFix-06-<kurzbezeichnung>` von `main` anlegen.
2. Fresh-Clone-Szenario lokal durchspielen (Teil 1, Umfang 1–4), Befunde protokollieren.
3. `scripts/compose-smoke-test.sh --build` ausführen.
4. Volles Test-Gate ausführen.
5. Teile 2–4 implementieren (SSRF-Lockerung + Zertifikate, Kosten-Fixes/-Tabelle/-Neustart, Dashboard-Pinning) mit Tests.
6. Teil 5 (Doku Englisch) und Teil 6 (Endanwender-Deployment) umsetzen.
7. Teil 7: `docs/release-guide.md` erstellen.
8. Bei Fehlern: Root Cause analysieren und beheben **innerhalb** dieses Pakets.
9. Review-Loop wie gehabt (@code-reviewer, Ergebnis verbatim nach `docs/reviews/BugFix-06-review-<n>.md`), Findings fixen, Runden wiederholen bis Abbruchbedingung (max. 5 Runden).
10. Am Ende: alle Podman/Docker-Artefakte aufräumen (AGENTS.md Regeln 9–11), Commit `BugFix-06: ...` auf dem neuen Branch, PR gegen `main` (Merge durch Reviewer/Mensch).

## Referenzen

- AGENTS.md (Docker Compose primary, Required Future-Feature Contract, Podman-Hinweise 1–11, Aufräum-Regeln 9–11)
- `prompts/00-gemeinsame-regeln.md` (verbindliche Ausführungsregeln: Branch-Schema, PR, Merge-Verbot, Secrets, Tests)
- `docs/docker-image-guide.md` (Liefer-/Deploy-Dokumentation)
- `scripts/compose-smoke-test.sh` (Smoke-Gate inkl. `--build`)
- `Dockerfile`, `Dockerfile.test`, `apps/{api,web,worker}/Dockerfile` (BugFix-04/05-Änderungen)
- `docker-compose.yml`, `docker-compose.test.yml`, `docker-compose.override.yml`, `.dockerignore`, `.env.example`
- `.github/workflows/ci.yml` (`compose-smoke`-Job: `docker compose build api web worker`)
- SSRF-Guard: `apps/api/src/common/connectivity/connectivity-guard.ts` (+ `__tests__/connectivity-guard.spec.ts`), Nutzung in `apps/api/src/features/system-config/system-config.service.ts` und `apps/api/src/features/admin-settings/admin-settings.controller.ts`; Settings-Catalog `packages/foundation/src/config/settings-catalog.ts`; i18n `apps/web/src/i18n/locales/{de,en}.ts`
- Kosten: `apps/api/src/features/cost-tracking/{cost-tracking.controller.ts,cost-tracking.service.ts}`, UI `apps/web/src/app/policies/[id]/costs/**`, `costs-overview-card.tsx`, Tab-Komponenten mit Sequenz-Schutz (`covered-persons-tab.tsx`, `documents-tab.tsx`, `portal-links-tab.tsx`)
- Dashboard: bestehende Dashboard-Seite (`apps/web/src/app/**`), Prisma-Schema `prisma/schema.prisma` (Migrationen unter `prisma/migrations/`)
- OIDC/AI: `apps/api/src/features/identity/{identity.module.ts,oidc.strategy.ts}`, `apps/api/src/features/ai-assist/**`
- BugFix-04 (Commit `09e680b`), BugFix-05 (Commits `e1ca357`, `eb855ac`) inkl. `docs/reviews/BugFix-04-review-*.md`, `docs/reviews/BugFix-05-review-*.md`
