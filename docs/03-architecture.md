# Architektur

## Zielbild
Empfohlen wird ein **modularer Monolith** mit vertikal geschnittenen Feature-Slices. Jedes Feature kapselt API, Domainlogik, Persistenzadapter, UI-Module, Hintergrundjobs und Integrationen soweit möglich eigenständig.

## Warum modularer Monolith zuerst
- Ein Deployment-Artefakt reduziert Betriebsaufwand im Docker-Compose-Setup.
- Klare Feature-Grenzen bleiben erhalten.
- Spätere Extraktion einzelner Features in Dienste bleibt möglich.
- Admin-UI, OIDC, Jobs und Berechtigungen sind in einer Anwendung einfacher konsistent.

## Technologievorschlag
- Backend: NestJS oder Spring Boot; bevorzugt **NestJS** wegen guter Modularisierung, OpenAPI, WebSocket/Jobs-Ökosystem und schneller Fullstack-Umsetzung.
- Frontend: **Next.js** oder React + Vite; bevorzugt **Next.js** mit App Router nur für UI/SSR, kein erzwungener Coupling zur API.
- Datenbank: **PostgreSQL**.
- Objekt-/Dateispeicher: S3-kompatibel, initial MinIO optional; alternativ lokales Volume.
- Queue/Jobs: Redis + BullMQ.
- Suche optional: PostgreSQL Full Text zuerst, keine zusätzliche Suchmaschine in V1.
- Auth: Lokale Benutzername/Passwort-Authentifizierung (Default für Entwicklung) plus optional OIDC via Keycloak, Authentik oder externer IdP als zweiter, an ein lokales Konto gebundener Login-Weg (ADR-007).
- UI-Architektur: **CSS Custom Properties** mit @layer-Kaskade für das Design System (siehe `docs/11-ui-ux.md`). React-Komponenten in `apps/web/src/components/ui/`. Theme-Provider in `apps/web/src/contexts/` für Farbwahl.

## Strukturelle Regeln
- Kein Shared-Domain-Monster-Modul.
- Gemeinsame Bausteine nur als technische Foundation-Module, nicht als fachliche Sammelstelle.
- Kommunikation zwischen Features über interne Events, stabile Interfaces oder Query-Ports.
- Jede Integration ist optional und über Capability-Flags registriert.
- Wenn ein abhängiges Feature fehlt, wird nur die konkrete Teilfunktion deaktiviert.

## Docker Compose Service-Topologie

### Laufzeitstack

```
┌─────────────┐     ┌─────────────┐
│   Web       │     │    API      │
│ (Next.js)   │────▶│  (NestJS)   │
│ :3000       │     │  :3001      │
└─────────────┘     └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │    DB    │ │  Redis   │ │ Worker   │
       │PostgreSQL│ │          │ │(BullMQ)  │
       │  :5432   │ │  :6379   │ │          │
       └──────────┘ └──────────┘ └──────────┘
```

### Netzwerke
- Alle Dienste kommunizieren über das interne Bridge-Netzwerk `insura-internal`.
- Nur öffentliche Dienste (Web, API) exponieren Ports nach außen.
- Datenbank, Redis, Worker sind nur intern erreichbar.

### Volumes
| Volume | Zweck | Persistenz |
|--------|-------|-----------|
| `postgres-data` | PostgreSQL-Daten | Ja |
| `redis-data` | Redis-Persistenz (AOF) | Ja |
| `uploads-data` | Lokale Dokumenten-Uploads | Ja |
| `minio-data` | MinIO-Objektspeicher (optional) | Ja |

### Health Checks
| Service | Endpoint | Abhängigkeiten |
|---------|----------|---------------|
| db | `pg_isready` | – |
| redis | `redis-cli ping` | – |
| api | `GET /health` (liveness), `GET /ready` (readiness) | db, redis |
| web | HTTP 200 on `/` | api |
| worker | – (kein HTTP) | db, redis |
| storage | MinIO health endpoint | – |

### Startup-Reihenfolge
1. `db` – PostgreSQL startet und wird healthy.
2. `redis` – Redis startet und wird healthy.
3. `migration` – Läuft nach db-healthy, führt `prisma migrate deploy` aus, terminiert.
4. `api` – Startet nach erfolgreicher Migration und healthy redis.
5. `worker` – Startet parallel mit api.
6. `web` – Startet nach healthy api.

## Testarchitektur

Testdienste laufen in einer isolierten Compose-Umgebung (`docker-compose.test.yml`):
- `test-db`, `test-redis` – dedizierte Test-Infrastruktur
- `test` – Einmal-Container, der Lint, Typecheck, Unit-Tests und Migrationsprüfung ausführt
- Produktionsvolumes werden nicht verwendet

## Beispiel Feature-Degradation
- AI Provider nicht konfiguriert: Vertragserfassung bleibt nutzbar, nur Extraktion/Zusammenfassung wird ausgeblendet.
- Paperless nicht verbunden: Dokumentenablage im lokalen Speicher bleibt nutzbar.
- Portal-Mailbox-Connector fehlt: Portal-Link bleibt sichtbar, Inbox-Ansicht entfällt.
