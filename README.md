# Insura

Softwarekonzept für eine private Haushalts-Versicherungsübersicht mit modularer, vertikal geschnittenen Architektur.

## Ziel
Insura verwaltet Versicherungsverträge, Dokumente, Kostenhistorien, Portal-Links und optionale AI-gestützte Extraktion/Zusammenfassungen für Privathaushalte.

## Schnellstart mit Docker Compose

Starten Sie den kompletten Insura Stack mit einem einzigen Befehl:

```bash
docker compose up --build
```

Dies startet alle benötigten Dienste:
- `web`: Next.js Frontend (Port 3000)
- `api`: NestJS Backend (Port 3001)
- `db`: PostgreSQL Datenbank
- `redis`: Redis Queue/Cache
- `storage`: MinIO Dateispeicher (optional)

### Voraussetzungen
- Docker und Docker Compose installiert
- Port 3000 und 3001 sind frei

### Erste Schritte
1. Klonen Sie das Repository
2. Kopieren Sie `.env.example` nach `.env` und passen Sie die Einstellungen an
3. Führen Sie `docker compose up --build` aus
4. Öffnen Sie http://localhost:3000 im Browser

### Wichtige Ports
- Web Frontend: http://localhost:3000
- API Backend: http://localhost:3001
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- MinIO Storage: http://localhost:9000 (Console: http://localhost:9001)

### Datenpersistenz
Daten werden in benannten Volumen gespeichert:
- PostgreSQL Daten: `postgres-data`
- Redis Daten: `redis-data`
- MinIO Daten: `minio-data`

### Reset der Entwicklungsumgebung
Um alle Daten zurückzusetzen:
```bash
docker compose down -v
```

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
- `docs/adr/ADR-001-vertical-slices.md`
- `docs/adr/ADR-002-modular-monolith-first.md`
- `docs/adr/ADR-003-async-ai-and-imports.md`
