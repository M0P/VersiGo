# Admin und Betrieb

## Docker Compose Betrieb

### Voraussetzungen
- Docker Engine 24+ oder Podman 5+ mit docker-compose-kompatiblem Wrapper
- 4 GB+ RAM, 10 GB+ freier Speicher

### Konfiguration

Siehe `.env.example` für alle Konfigurationsvariablen. Erforderliche Variablen:

| Variable | Beschreibung | Beispiel |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL-Verbindung | `postgresql://insura:pass@db:5432/insura` |
| `REDIS_URL` | Redis-Verbindung | `redis://redis:6379` |
| `SESSION_SECRET` | Session-Secret (min. 32 Zeichen) | `openssl rand -hex 32` |
| `SETTINGS_ENCRYPTION_KEY` | AES-256-GCM Schlüssel (64 Hex-Zeichen) | `openssl rand -hex 32` |

Optionale Variablen für OIDC, lokale Authentifizierung, AI, Paperless-ngx, S3 sind in `.env.example` dokumentiert.

## Lokale Authentifizierung

Die lokale Benutzername/Passwort-Authentifizierung wird über die Umgebungsvariable `LOCAL_AUTH_ENABLED=true` aktiviert.

### Entwicklung
Für die lokale Entwicklung kann die lokale Authentifizierung ohne OIDC-Provider genutzt werden:
```
LOCAL_AUTH_ENABLED=true
```

### Betriebshinweise
- Beide Authentifizierungsmethoden (OIDC und lokal) können gleichzeitig aktiv sein
- Bei ausschließlicher Nutzung der lokalen Authentifizierung muss OIDC deaktiviert sein (`OIDC_ENABLED=false`)
- Wenn keine Authentifizierungsmethode aktiviert ist, startet die Anwendung nicht (Konfigurationsfehler)
- Benutzerkonten für die lokale Anmeldung müssen über die Admin-Oberfläche oder Skripte angelegt werden (derzeit kein Self-Service)
- Ein Passwort-Reset per E-Mail ist derzeit nicht implementiert (geplante Erweiterung)

### Health Checks

| Endpoint | Typ | Beschreibung |
|----------|-----|-------------|
| `GET /health` | Liveness | Gibt `{"status":"ok"}` zurück |
| `GET /ready` | Readiness | Prüft DB, Redis und Capabilities; gibt `{"status":"ready","database":"up","redis":"up","capabilities":{...}}` zurück |

### Backup

#### Datenbank
```bash
docker compose exec -T db pg_dump -U insura insura > backup_$(date +%Y%m%d).sql
```

#### Uploads
```bash
docker run --rm -v insura_uploads-data:/data -v $(pwd):/backup alpine tar czf /backup/uploads_$(date +%Y%m%d).tar.gz -C /data .
```

### Restore

#### Datenbank
```bash
docker compose exec -T db psql -U insura -d insura < backup_20260101.sql
```

#### Uploads
```bash
docker run --rm -v insura_uploads-data:/data -v $(pwd):/backup alpine tar xzf /backup/uploads_20260101.tar.gz -C /data
```

### Migration

Migrationen laufen automatisch beim Start des `migration`-Services, bevor API/Worker starten.

Manuelles Ausführen:
```bash
docker compose run --rm migration
```

### Reset

Alle Daten zurücksetzen (Entwicklung):
```bash
docker compose down -v
```

Danach `docker compose up --build` für einen frischen Start.

### Troubleshooting

#### API startet nicht
```bash
docker compose logs api
# Prüfe Datenbankverbindung und Migrationsstatus
```

#### Datenbankverbindungsfehler
```bash
docker compose exec -T db pg_isready -U insura -d insura
```

#### Worker startet nicht
```bash
docker compose logs worker
# Prüfe Redis-Verbindung
```

#### Volumes bereinigen
```bash
docker compose down -v
# Entfernt postgres-data, redis-data, uploads-data, minio-data
```

### Upgrade

```bash
git pull
docker compose build
docker compose up -d
```

Migrationen laufen automatisch über den `migration`-Service.

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
