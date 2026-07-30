# Admin und Betrieb

## Docker-Compose Prinzipien
- Möglichst wenige Pflichtvariablen.
- Erststart-Assistent im Admin-UI für Basis-Setup.
- Integrationen können nach dem Start vollständig im UI eingerichtet werden.
- Alle Services sind durch Docker Compose orchestriert und dokumentiert.

## Minimale Umgebungsvariablen
- `APP_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `BOOTSTRAP_ADMIN_EMAIL` oder OIDC Bootstrap-Regel
- optional `STORAGE_ENDPOINT` bei S3

## Docker Compose Deployment
Der gesamte Insura Stack kann mit Docker Compose gestartet werden:

```bash
docker compose up --build
```

Dies startet folgende Dienste:
- `web`: Next.js Frontend (Port 3000)
- `api`: NestJS Backend (Port 3001)
- `db`: PostgreSQL Datenbank
- `redis`: Redis Queue/Cache
- `storage`: MinIO Dateispeicher (optional)

### Konfiguration
Die vollständige Konfiguration ist in `.env.example` dokumentiert. Für lokale Entwicklung kopieren Sie diese Datei nach `.env` und passen Sie die Werte an.

### Gespeicherte Daten
Daten werden in benannten Volumen gespeichert:
- PostgreSQL Daten: `postgres-data`
- Redis Daten: `redis-data`
- MinIO Daten: `minio-data`

### Reset der Entwicklungsumgebung
Um alle Daten zurückzusetzen:
```bash
docker compose down -v
```

## Admin-UI Bereiche
- Allgemein
- Haushalts- und Rollenregeln
- OIDC Konfiguration
- AI Provider
- Dokumentenspeicher
- Paperless-ngx
- Portal-Connectoren
- Feature-Flags
- Audit und Jobs

## Betriebsfunktionen
- Health-Checks pro Modul
- Migrationsstatus
- Queue-Status und Retry
- Provider-Connectivity-Test
- Konfigurationsvalidierung
