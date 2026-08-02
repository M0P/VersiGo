# VersiGo

VersiGo ist eine modulare Versicherungszentrale für Privathaushalte.

## Ziel

VersiGo verwaltet Versicherungsverträge, Dokumente, Kostenhistorien, Portal-Links und optionale AI-gestützte Extraktion/Zusammenfassungen für Privathaushalte.

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

# Stack starten
docker compose up --build
```

Nach dem Start sind die Dienste erreichbar unter:
- **Web UI:** http://localhost:3000
- **API:** http://localhost:3001
- **API Health:** http://localhost:3001/health
- **API Readiness:** http://localhost:3001/ready

### Lokale Authentifizierung und Initial-Admin

In der lokalen Entwicklung ist die lokale Benutzer-/Passwort-Anmeldung der
Standard (`LOCAL_AUTH_ENABLED=true`, `OIDC_ENABLED=false`). Beim ersten Start
auf einer leeren Datenbank legt die API genau einen initialen Administrator aus
`LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD` der `.env` an (idempotent,
Passwort nur als bcrypt-Hash). Anmeldung:

```bash
curl -sS -X POST http://localhost:3001/auth/local/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"localadmin","password":"<IHR_PASSWORT>"}'
```

Neue Konten werden über `POST /auth/register` angelegt und müssen von einem
Administrator über `POST /admin/users/:id/approve` freigeschaltet werden
(Status `PENDING_APPROVAL`, siehe `docs/07-security-privacy.md`).

In Produktion (`NODE_ENV=production`) greift der Fail-Fast: Ohne explizit
gesetzte `OIDC_ENABLED=true`- oder `LOCAL_AUTH_ENABLED=true`-Konfiguration
startet die API nicht. Ein Default-Admin wird dort niemals angelegt.

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

## Docker-Free Fallback

Für lesenden Zugriff oder kleine Änderungen ohne Docker:

```bash
# Voraussetzung: Node.js 24, pnpm, PostgreSQL, Redis lokal installiert
pnpm install
pnpm run build
pnpm run dev
```

Dieser Modus ist **nicht** für CI, Releases oder vollständige Testverifikation geeignet.

## Entwicklungsmodus (Turbo)

Der Dev-Modus wird über Turborepo gestartet (mit laufender Datenbank und
Redis, z. B. aus dem Compose-Stack):

```bash
pnpm run dev         # API, Worker und Web parallel (Watch-Mode)
pnpm run dev:api     # nur NestJS-API
pnpm run dev:web     # nur Next.js-Web
pnpm run dev:worker  # nur Worker
```

Der `dev`-Task baut zuerst die Workspace-Abhängigkeiten (`^build`) und startet
danach die Watch-Prozesse. `turbo.json` setzt `envMode: "loose"`, damit die
Konfigurationsvariablen der Umgebung (`.env`) an die Dev-Prozesse durchgereicht
werden.

Der Next.js-Dev-Server erlaubt HMR/Dev-Anfragen standardmäßig nur von
`localhost`. Wird die Web-UI über eine andere Origin aufgerufen (z. B. LAN-IP
oder Reverse-Proxy), die in `NEXT_ALLOWED_DEV_ORIGINS` als kommaseparierte
Liste (`host` oder `host:port`) ergänzen – z. B.
`NEXT_ALLOWED_DEV_ORIGINS=192.168.24.8:3000`. Die Einstellung gilt nur im
Dev-Modus.

## Personalisierung

Nach der Anmeldung können Sie unter **Mein Profil** (http://localhost:3000/settings,
`USER`/`ADMIN`):

- **Profil bearbeiten**: Anzeigename und Sprache (Locale-Allowlist)
- **Akzentfarbe wählen**: 8 Preset-Farben oder ein eigener Hex-Farbwert
- **Helles/dunkles Design**: Umschaltung per Klick im Topbar oder in den Einstellungen
- Die Einstellung wird pro Benutzer serverseitig gespeichert
- `READ_ONLY`-Konten sehen keine editierbaren Einstellungen (Server: 403)

## Systemeinstellungen (Admin, AP-17)

Admins verwalten die zentrale Systemkonfiguration unter
**Systemeinstellungen** (http://localhost:3000/admin/settings, nur `ADMIN`):

- **Katalogbasiert (Allowlist):** Nur dokumentierte Schlüssel sind setzbar;
  Infrastruktur-/Bootstrap-Werte (DB, Redis, Secrets, Ports, TLS/Proxy) sind
  ausschließlich Environment/Compose.
- **Priorität:** gültiger UI-Wert (Datenbank) > `.env`-Fallback > Code-Default.
  Die UI zeigt pro Schlüssel Quelle, Fallback-Grund und effektiven Wert.
- **Secrets** (z. B. `AI_OPENAI_COMPAT_API_KEY`, `PAPERLESS_API_TOKEN`) werden
  verschlüsselt gespeichert und nur maskiert angezeigt.
- **Neustart-Werte** (z. B. `STORAGE_ENABLED`) werden als „Neustart
  erforderlich" markiert und beim nächsten Start aktiv.
- **Connectivity-Tests** für AI-/Paperless-Endpunkte direkt aus der UI.
- Änderungen werden revisionssicher auditiert (ohne Werte/Secrets).
- Vollständiger Katalog: `docs/13-settings-catalog.md`.

## Architektur

- **Modularer Monolith** mit vertikal geschnittenen Features (siehe `docs/03-architecture.md`)
- **Backend:** NestJS (API + Worker)
- **Frontend:** Next.js (Web)
- **Design System:** CSS Custom Properties mit Theme-Provider (siehe `docs/11-ui-ux.md`)
- **Datenbank:** PostgreSQL mit Prisma ORM
- **Queue/Cache:** Redis + BullMQ
- **Dateispeicher:** Lokales Volume (optional MinIO/S3)
- **Auth:** OIDC (Keycloak, Authentik, etc.)

## Dokumente

- `docs/01-product-vision.md`
- `docs/02-requirements.md`
- `docs/03-architecture.md`
- `docs/04-data-model.md`
- `docs/05-feature-slices.md`
- `docs/06-integrations.md`
- `docs/07-security-privacy.md`
- `docs/08-admin-operations.md`
- `docs/09-ai-agent-implementation-plan.md`
- `docs/10-quality-and-library-policy.md`
- `docs/11-ui-ux.md`
- `docs/12-roadmap.md`
- `docs/13-settings-catalog.md`
- `docs/adr/` – Architecture Decision Records
