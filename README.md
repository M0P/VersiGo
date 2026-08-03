# VersiGo

> **⚠️ WICHTIGER HINWEIS**
>
> **VersiGo wurde vollständig mit AI erstellt. Das Projekt ist experimentell, nicht sicherheitsgeprüft und nicht für einen aus dem Internet erreichbaren Betrieb vorgesehen. Betreiben Sie es ausschließlich in einer vertrauenswürdigen, abgeschotteten privaten Umgebung und verwenden Sie keine produktiven oder besonders schützenswerten Daten ohne eigene Sicherheitsprüfung.**
>
> *Dieser Hinweis darf nicht durch Formulierungen wie „production ready“, „sicher“ oder „öffentlich betreibbar“ relativiert werden.*

---

VersiGo ist eine modulare Versicherungszentrale für Privathaushalte.

## Ziel

VersiGo verwaltet Versicherungsverträge, Dokumente, Kostenhistorien, Portal-Links und optionale AI-gestützte Extraktion/Zusammenfassungen für Privathaushalte.

## Mitwirken

Hilfe, Reviews, Tests, Fehlerberichte, Sicherheitsmeldungen, Dokumentationsverbesserungen und Pull Requests sind **ausdrücklich erwünscht**.

**Niedrigschwelliger Beitragsweg:**
1. Forken Sie das Repository
2. Erstellen Sie einen Feature-Branch (`git checkout -b feat/meine-verbesserung`)
3. Committen Sie Ihre Änderungen mit aussagekräftigen Messages
4. Öffnen Sie einen Pull Request gegen `main`
5. Beschreiben Sie kurz: Was wurde geändert? Warum? Wie getestet?

Bei Sicherheitsfunden nutzen Sie bitte **GitHub Security Advisories** (nicht öffentliche Issues).

---

## Quick Start

### Voraussetzungen

- Docker (oder Podman mit `podman-compose` und `docker-compose` kompatibler CLI)
- Git

### Erster Start

```bash
git clone <repository-url>
cd versigo

# Umgebung konfigurieren
cp .env.example .env
# (optional) .env anpassen, insbesondere Secrets generieren:
#   openssl rand -hex 32  # für SETTINGS_ENCRYPTION_KEY und SESSION_SECRET
# Lokale Entwicklung: LOCAL_AUTH_ENABLED=true (Default) und einen
# eigenen LOCAL_ADMIN_PASSWORD-Wert in .env setzen.
# ACHTUNG Beta-/Produktionsbetrieb: .env.example ist auf NODE_ENV=development
# vorkonfiguriert. Für den Beta-Betrieb NODE_ENV=production in der .env setzen
# (Sicherheitsgarantien, siehe "Voraussetzungen für Beta-Betrieb" und
# docs/docker-image-guide.md Abschnitt 5).

# Stack starten
docker compose up --build
```

Nach dem Start sind die Dienste erreichbar unter:
- **Web UI:** http://localhost:3000
- **API:** http://localhost:3001
- **API Health:** http://localhost:3001/health
- **API Readiness:** http://localhost:3001/ready

### Lokale Authentifizierung und Initial-Admin

In der lokalen Entwicklung ist die lokale Benutzer-/Passwort-Anmeldung der Standard (`LOCAL_AUTH_ENABLED=true`, `OIDC_ENABLED=false`). Beim ersten Start auf einer leeren Datenbank legt die API genau einen initialen Administrator aus `LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD` der `.env` an (idempotent, Passwort nur als bcrypt-Hash). Anmeldung:

```bash
curl -sS -X POST http://localhost:3001/auth/local/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"localadmin","password":"<IHR_PASSWORT>"}'
```

Neue Konten werden über `POST /auth/register` angelegt und müssen von einem Administrator über `POST /admin/users/:id/approve` freigeschaltet werden (Status `PENDING_APPROVAL`, siehe `docs/07-security-privacy.md`).

In Produktion (`NODE_ENV=production`) greift der Fail-Fast: Ohne explizit gesetzte `OIDC_ENABLED=true`- oder `LOCAL_AUTH_ENABLED=true`-Konfiguration startet die API nicht. Ein Default-Admin wird dort **niemals automatisch** angelegt: `LOCAL_AUTH_ENABLED` ist in Produktion per Default deaktiviert, und der initiale Administrator wird nur angelegt, wenn `LOCAL_AUTH_ENABLED=true` **und** `LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD` ausdrücklich gesetzt sind. Das Platzhalter-Passwort aus `.env.example` wird in Produktion abgelehnt.

### Stoppen und Zurücksetzen

```bash
# Stack herunterfahren
docker compose down

# Alle Daten löschen (Datenbank, Redis, Uploads)
docker compose down -v

# Nur Entwicklungsdaten zurücksetzen (ohne andere Docker-Ressourcen)
docker compose down -v --remove-orphans
```

### Logs anzeigen

```bash
docker compose logs -f          # Alle Dienste
docker compose logs -f api      # Nur API
docker compose logs -f web      # Nur Web
docker compose logs -f worker   # Nur Worker
```

---

## Tests und Qualitätssicherung

Alle Tests laufen in Docker-Containern:

```bash
# Vollständige Testsuite (Lint, Typecheck, Unit-Tests, Migration Check)
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test

# Compose Smoke-Test (Stack starten + Health-Checks + API/Web-Verfügbarkeit)
./scripts/compose-smoke-test.sh --build

# Einzelne Prüfungen
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run lint"
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run typecheck"
docker compose -f docker-compose.test.yml run --rm test sh -c "pnpm run test"
```

---

## Docker-Free Fallback

Für lesenden Zugriff oder kleine Änderungen ohne Docker:

```bash
# Voraussetzung: Node.js 24, pnpm, PostgreSQL, Redis lokal installiert
pnpm install
pnpm run build
pnpm run dev
```

Dieser Modus ist **nicht** für CI, Releases oder vollständige Testverifikation geeignet.

---

## Entwicklungsmodus (Turbo)

Der Dev-Modus wird über Turborepo gestartet (mit laufender Datenbank und Redis, z. B. aus dem Compose-Stack):

```bash
pnpm run dev         # API, Worker und Web parallel (Watch-Mode)
pnpm run dev:api     # nur NestJS-API
pnpm run dev:web     # nur Next.js-Web
pnpm run dev:worker  # nur Worker
```

Der `dev`-Task baut zuerst die Workspace-Abhängigkeiten (`^build`) und startet danach die Watch-Prozesse. `turbo.json` setzt `envMode: "loose"`, damit die Konfigurationsvariablen der Umgebung (`.env`) an die Dev-Prozesse durchgereicht werden.

Der Next.js-Dev-Server erlaubt HMR/Dev-Anfragen standardmäßig nur von `localhost`. Wird die Web-UI über eine andere Origin aufgerufen (z. B. LAN-IP oder Reverse-Proxy), die in `NEXT_ALLOWED_DEV_ORIGINS` als kommaseparierte Liste (`host` oder `host:port`) ergänzen – z. B. `NEXT_ALLOWED_DEV_ORIGINS=192.168.24.8:3000`. Die Einstellung gilt nur im Dev-Modus.

---

## Funktionsübersicht

| Bereich | Features | Status |
|---------|----------|--------|
| **Authentifizierung** | Lokale Anmeldung (Username/Password), OIDC (Keycloak, Authentik, etc.), Registrierung mit Admin-Freigabe, Rollen (ADMIN, USER, READ_ONLY) | ✅ |
| **Versicherungsverwaltung** | Policies CRUD, Versicherte Personen, Kostenhistorie, Dokumente, Portal-Links | ✅ |
| **Dokumente** | Upload (lokal/MinIO), Kategorisierung, Versionierung, AI-Extraktion | ✅ |
| **Kostenübersicht** | Haushaltsweite Aggregation, Diagramme, Filter | ✅ |
| **Family Sharing** | Objektbasierte Freigaben zwischen Household-Mitgliedern (Übersicht, Erstellen, Berechtigungen) | ✅ |
| **Admin: Systemeinstellungen** | Katalogbasiert (Allowlist), Priorität UI > ENV > Default, Secrets verschlüsselt, Connectivity-Tests, Audit-Log | ✅ |
| **Admin: Feature-Flags** | Global & Household-spezifisch, Toggle in UI | ✅ |
| **Admin: Integrationen** | AI (Ollama/OpenAI-compat), Paperless-ngx, Portal-Connectors | ✅ |
| **AI Assist** | Dokument-Extraktion, Deckungszusammenfassungen (optional, Queue-basiert) | ✅ |
| **Paperless-ngx** | Dokumenten-Sync, Tagging (optional) | ✅ |
| **Portal-Connectors** | Katalog (HUK-COBURG, etc.), Deeplinks, Plugin-Rahmen (experimentell) | ✅ |
| **Audit & Monitoring** | Audit-Log (Admin), Queue-Monitoring, Worker-Heartbeat, Integrations-Status | ✅ |
| **Datenschutz** | DSGVO-Export (Art. 15), Konto-Löschung mit Last-Admin-Schutz | ✅ |
| **Internationalisierung** | Deutsch/Englisch, persistent (USER/ADMIN) oder session-only (READ_ONLY) | ✅ |
| **Design System** | Hell/Dunkel, 8 Akzentfarben + Custom, CSS Custom Properties | ✅ |

---

## Architektur

- **Modularer Monolith** mit vertikal geschnittenen Features (siehe `docs/03-architecture.md`)
- **Backend:** NestJS (API + Worker)
- **Frontend:** Next.js 16 (App Router, React 19, Standalone Output)
- **Design System:** CSS Custom Properties mit Theme-Provider (siehe `docs/11-ui-ux.md`)
- **Datenbank:** PostgreSQL 16 mit Prisma ORM
- **Queue/Cache:** Redis 7 + BullMQ 5
- **Dateispeicher:** Lokales Volume (optional MinIO/S3)
- **Auth:** OIDC (Keycloak, Authentik, etc.) + lokale Username/Password

---

## Voraussetzungen für Beta-Betrieb

> **Zwingend für Beta/Produktion:** In der `.env` **`NODE_ENV=production`**
> setzen (`.env.example` ist für die lokale Entwicklung auf
> `development` vorkonfiguriert). Erst mit `NODE_ENV=production` greifen die
> Sicherheitsgarantien: kein automatisch angelegter Default-Admin, Ablehnung
> des `.env.example`-Platzhalter-Passworts, Session-Cookie mit `Secure`-Flag
> und Auth-Fail-Fast beim Start. Der Compose-Smoke-Test verifiziert diesen
> Produktionspfad (Schritt 12).

| Ressource | Minimum | Empfohlen | Hinweis |
|-----------|---------|-----------|---------|
| CPU | 2 vCPU | 4 vCPU | Für AI-Queue Worker |
| RAM | 2 GB | 4 GB | API + Worker + Web + DB + Redis |
| Persistenter Speicher | 5 GB | 20 GB | PostgreSQL + Redis + Uploads |
| Backup-Speicher | 2× Daten | 3× Daten | Tägliche pg_dump + Volume-Snapshots |
| Upload-Wachstum | – | 1–5 GB/Monat | Je nach Dokumentenaufkommen |

---

## Konfiguration

Alle Umgebungsvariablen sind in `.env.example` **pro Variable** mit Zweck,
sicherem Platzhalter-Beispielwert, Sicherheitsrelevanz und Default
dokumentiert (verbindliche Referenz). Die folgende Tabelle fasst die
Kategorien mit Beispielwerten und Sicherheitsrelevanz zusammen:

| Kategorie | Variablen | Pflicht | Service | Beispielwert | Sicherheitsrelevanz |
|-----------|-----------|---------|---------|--------------|---------------------|
| **Infrastruktur** | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `APP_PORT`, `WEB_PORT` | Ja | Alle | `postgresql://versigo:change-me@db:5432/versigo` | DB-Passwort kein Default; nur internes Netz |
| **Secrets** | `SESSION_SECRET`, `SETTINGS_ENCRYPTION_KEY` | Ja | API, Worker | `openssl rand -hex 32` | Mind. 32 Zufallszeichen; Leak = Session-Impersonation / Entschlüsselung |
| **Auth** | `LOCAL_AUTH_ENABLED`, `LOCAL_ADMIN_*`, `OIDC_*`, `CORS_ORIGINS`, `TRUST_PROXY`, `COOKIE_SECURE` | Ja (mind. eine Auth-Methode) | API, Worker | `LOCAL_ADMIN_PASSWORD=<stark>`; `TRUST_PROXY=false`; `COOKIE_SECURE` leer | Platzhalter-Passwort wird in Produktion abgelehnt; `TRUST_PROXY` nur hinter Proxy; `COOKIE_SECURE` nur bei HTTP-Betrieb explizit setzen (Default: true in Produktion) |
| **Storage** | `STORAGE_ENABLED`, `DOCUMENTS_STORAGE_PATH`, `S3_*`, `MINIO_*` | Nein | API, Worker | `change-me`-Platzhalter | Zugangsdaten nie Default; Pfad im Volume |
| **AI** | `AI_ENABLED`, `AI_PROVIDER`, `AI_OLLAMA_*`, `AI_OPENAI_COMPAT_*` | Nein | API, Worker | `AI_ENABLED=false` (opt-in) | API-Key nur bei expliziter Aktivierung; Daten fließen nur dann |
| **Paperless** | `PAPERLESS_ENABLED`, `PAPERLESS_URL`, `PAPERLESS_API_TOKEN` | Nein | API | `PAPERLESS_ENABLED=false` (opt-in) | Token nur bei Aktivierung; Datenverlassen nur dann |
| **Worker Health** | `WORKER_HEALTH_PORT`, `WORKER_HEARTBEAT_*` | Nein | Worker | `3100` (nur intern) | Port nicht an den Host gebunden |

**Sichere Defaults:** Alle Secrets haben in `.env.example` Platzhalter (`change-me`). In Produktion **müssen** eigene Werte generiert werden (`openssl rand -hex 32`). Für den Beta-/Produktionsbetrieb ist zwingend `NODE_ENV=production` zu setzen (siehe „Voraussetzungen für Beta-Betrieb" oben).

**Validierung:** Unbekannte, unsichere oder widersprüchliche Konfigurationen führen beim Start zu klarem Fehler (Fail-Fast).

---

## Ports, Volumes & Daten

| Service | Ports (intern) | Ports (extern, Compose) | Volumes | Gespeicherte Daten |
|---------|----------------|-------------------------|---------|-------------------|
| **PostgreSQL** | 5432 | – | `postgres-data` | Alle relationalen Daten (User, Policies, Settings, Audit, etc.) |
| **Redis** | 6379 | – | `redis-data` | BullMQ Queues, Cache, Session-Store |
| **API** | 3001 | `${APP_PORT:-3001}` | `uploads-data` (Mount) | – (stateless) |
| **Worker** | 3100 (Health, nur intern) | – | `uploads-data` (Mount) | – (stateless) |
| **Web** | 3000 | `${WEB_PORT:-3000}` | – | – (stateless) |
| **MinIO** (optional) | 9000/9001 | – | `minio-data` | S3-kompatibler Objektspeicher |

---

## AI & Externe Integrationen (Optional)

| Integration | Zweck | Empfangene Daten | Deaktivierung |
|-------------|-------|------------------|---------------|
| **AI Assist (Ollama)** | Lokale LLM-Extraktion | Dokumenten-Text, Metadaten | `AI_ENABLED=false` |
| **AI Assist (OpenAI-compat)** | Cloud-LLM-Extraktion | Dokumenten-Text, Metadaten, API-Key | `AI_ENABLED=false` |
| **Paperless-ngx** | Dokumenten-Sync | Dokumenten-Metadaten, Datei-Referenzen | `PAPERLESS_ENABLED=false` |
| **Portal-Connectors** | Versicherer-Portal Deeplinks | Keine (nur Konfiguration) | Feature-Flag `portalConnectors.enabled=false` |

**Wichtig:** Alle Integrationen sind **opt-in** (Standard: deaktiviert). Keine Daten verlassen das System ohne explizite Konfiguration.

---

## Tool-Dokumentation

| Tool | Version | Zweck | Wichtige Befehle |
|------|---------|-------|------------------|
| **Docker / Compose** | 24+ / 2.24+ | Container-Orchestrierung | `docker compose up --build`, `docker compose down -v` |
| **pnpm** | 11.17.0 | Package Manager (Monorepo) | `pnpm install`, `pnpm run build`, `pnpm run test` |
| **Node.js** | 24.x | Runtime | – |
| **Turbo** | 2.10+ | Build-Orchestrierung | `turbo run build`, `turbo run dev` |
| **Prisma** | 6.19+ | ORM & Migrationen | `npx prisma migrate deploy`, `npx prisma generate` |
| **Redis / BullMQ** | 7.4 / 5.34 | Queue & Cache | – |
| **Next.js** | 16.2 | Frontend Framework | `next build`, `next start` |
| **NestJS** | 11.0 | Backend Framework | `nest start`, `nest build` |

**Diagnose-Befehle:**
```bash
# Container-Status
docker compose ps

# Logs
docker compose logs -f api

# Datenbank-Migrationen prüfen
docker compose run --rm migration

# Prisma Studio (Dev only)
npx prisma studio

# Health-Checks
curl http://localhost:3001/health
curl http://localhost:3001/ready
curl http://localhost:3000/
```

---

## Troubleshooting

| Problem | Ursache | Lösung |
|---------|---------|--------|
| **API startet nicht: "KEINE AUTHENTIFIZIERUNGSMETHODE KONFIGURIERT"** | Weder `LOCAL_AUTH_ENABLED` noch `OIDC_ENABLED` gesetzt | In `.env` mind. eine Methode aktivieren: `LOCAL_AUTH_ENABLED=true` oder `OIDC_ENABLED=true` |
| **Datenbank nicht erreichbar** | `DATABASE_URL` falsch, DB nicht gestartet | `docker compose ps db`, `DATABASE_URL` in `.env` prüfen |
| **Redis Connection refused** | Redis nicht gestartet, falscher Port | `docker compose ps redis`, `REDIS_URL` prüfen |
| **Migration schlägt fehl** | Schema-Drift, Lock-Konflikt | `docker compose down -v` (Datenverlust!) oder manuell `npx prisma migrate resolve` |
| **Login schlägt fehl (401)** | Falsches Passwort, User nicht `ACTIVE`, `PENDING_APPROVAL` | Admin: User in `/admin/users` freigeben; Passwort zurücksetzen via DB |
| **Upload schlägt fehl** | `STORAGE_ENABLED=false`, Volume nicht gemountet, Datei zu groß | `STORAGE_ENABLED=true`, `docker compose ps`, nginx/Proxy `client_max_body_size` prüfen |
| **Build-Fehler: TypeScript Errors** | Code-Änderungen brechen Types | `pnpm run typecheck` lokal prüfen, `tsconfig.json` `strict: true` |
| **OIDC Login schlägt fehl** | `OIDC_*` Variablen falsch, Callback-URL mismatch | Issuer-URL, Client-ID/Secret, Callback-URL in IdP & `.env` abgleichen |
| **AI/Paperless Connectivity-Test fehlschlägt** | Falsche URL/Token, Netzwerk blockiert | `curl` von API-Container testen: `docker compose exec api curl -v <URL>` |
| **CORS-Fehler im Browser** | `CORS_ORIGINS` stimmt nicht mit Web-Origin überein | `CORS_ORIGINS=http://localhost:3000` (oder Ihre Domain) setzen |
| **Rate-Limit sperrt alle User** | `TRUST_PROXY=true` ohne echten Reverse-Proxy | `TRUST_PROXY=false` (Default) belassen, außer hinter vertrauenswürdigem Proxy |

---

## Beta-Grenzen (Offen & Ehrlich)

| Grenze | Details |
|--------|---------|
| **Kein öffentliches Hosting** | Nicht für Internet-zugänglichen Betrieb vorgesehen |
| **Keine Sicherheitszertifizierung** | Kein Pen-Test, kein Audit, keine Compliance-Garantie |
| **Keine Garantie für Datenverlustfreiheit** | Backups sind **Ihre** Verantwortung |
| **Keine Support-Zusage** | Community-Projekt, Best-Effort |
| **Kein Ersatz für eigene Backups** | `docker compose down -v` löscht alles unwiderruflich |
| **Unvollständige Features** | Notifications nur API, keine UI |
| **Experimentelle Plugins** | Portal-Connector "Mailbox Sync" ist `available: false` |
| **Keine automatische DB-Rückwärtsmigration** | Restore nur via Backup (`pg_dump` + Volume) |
| **Single-Tenant only** | Kein Multi-Tenant, keine Mandanten-Isolation über Households hinaus |

---

## Bekannte Einschränkungen

- **Family Sharing:** Haushaltsfreigaben enden an der eigenen Installation; kein Cross-Instance-Sharing
- **Notifications:** Nur API-Skelett, keine UI, keine Push/E-Mail
- **Paperless-Sync:** Nur Konfiguration + Connectivity-Test, kein automatischer Sync
- **Portal-Connector Plugin:** "Mailbox Sync" ist experimentell und deaktiviert (`available: false`)
- **OIDC:** Kein Auto-Provisioning – Admin muss Binding manuell setzen (ADR-007)
- **Sprache:** Nur Deutsch/Englisch (keine vollständige i18n für alle Strings)

---

## Dokumente

- `docs/01-product-vision.md` – Produktvision
- `docs/02-requirements.md` – Anforderungen
- `docs/03-architecture.md` – Architektur (Modularer Monolith, ADRs)
- `docs/04-data-model.md` – Datenmodell (Prisma Schema)
- `docs/05-feature-slices.md` – Feature-Slices Übersicht
- `docs/06-integrations.md` – Externe Integrationen
- `docs/07-security-privacy.md` – Sicherheits- & Datenschutzmodell
- `docs/08-admin-operations.md` – Betrieb (Backup, Restore, Upgrade, Migration)
- `docs/09-ai-agent-implementation-plan.md` – AI-Agent Plan
- `docs/10-quality-and-library-policy.md` – Qualitäts- & Bibliothekspolitik
- `docs/11-ui-ux.md` – UI/UX & Design System
- `docs/12-roadmap.md` – Roadmap
- `docs/13-settings-catalog.md` – Vollständiger Settings-Katalog
- `docs/adr/` – Architecture Decision Records (ADR-001 bis ADR-009)
- `docs/ui-control-matrix.md` – UI Control Matrix (alle Funktionen, Rollen, Berechtigungen, Tests)
- `docs/beta-release-checklist.md` – Beta Release Checkliste (Go/No-Go)
- `docs/release-notes-template.md` – Release Notes Vorlage
- `docs/docker-image-guide.md` – Docker Image Bau & Deployment Anleitung

---

## Lizenz

MIT License – siehe `LICENSE` Datei.

---

*Stand: 2026-08-03 | Beta-Version | Vollständig AI-erstellt*