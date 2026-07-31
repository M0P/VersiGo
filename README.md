# Insura

Softwarekonzept für eine private Haushalts-Versicherungsübersicht mit modularer, vertikal geschnittener Architektur.

## Ziel

Insura verwaltet Versicherungsverträge, Dokumente, Kostenhistorien, Portal-Links und optionale AI-gestützte Extraktion/Zusammenfassungen für Privathaushalte.

## Quick Start

### Voraussetzungen

- Docker (oder Podman mit `podman-compose` und `docker-compose` kompatibler CLI)
- Git

### Erster Start

```bash
git clone <repository-url>
cd insura

# Umgebung konfigurieren
cp .env.example .env
# (optional) .env anpassen, insbesondere Secrets generieren:
#   openssl rand -hex 32  # für SETTINGS_ENCRYPTION_KEY und SESSION_SECRET

# Stack starten
docker compose up --build
```

Nach dem Start sind die Dienste erreichbar unter:
- **Web UI:** http://localhost:3000
- **API:** http://localhost:3001
- **API Health:** http://localhost:3001/health
- **API Readiness:** http://localhost:3001/ready

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

## Personalisierung

Nach der Anmeldung können Sie unter **Einstellungen** (http://localhost:3000/settings):

- **Akzentfarbe wählen**: 8 Preset-Farben oder ein eigener Hex-Farbwert
- **Helles/dunkles Design**: Umschaltung per Klick im Topbar oder in den Einstellungen
- Die Einstellung wird pro Benutzer serverseitig gespeichert

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
- `docs/adr/` – Architecture Decision Records
