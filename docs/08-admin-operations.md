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
| `TRUST_PROXY` | Express `trust proxy`: nur `true`, wenn die API hinter einem vertrauenswürdigen Reverse-Proxy läuft (sonst fallen `req.ip` und die per-IP-Rate-Limits hinter dem Proxy auf die Proxy-IP zurück) | `false` |
| `CORS_ORIGINS` | Erlaubte Browser-Origins für CORS (Komma-separiert). Die Web-App ruft die API cross-origin mit `credentials` auf; nur gelistete Origins dürfen Antworten lesen. Mehrere Origins mit Komma trennen. | `http://localhost:3000` |

Optionale Variablen für OIDC, lokale Authentifizierung, AI, Paperless-ngx, S3 sind in `.env.example` dokumentiert.

## Lokale Authentifizierung

Die lokale Benutzername/Passwort-Authentifizierung wird über die Umgebungsvariable `LOCAL_AUTH_ENABLED=true` aktiviert.

### Entwicklung
Für die lokale Entwicklung kann die lokale Authentifizierung ohne OIDC-Provider genutzt werden:
```
LOCAL_AUTH_ENABLED=true
LOCAL_ADMIN_USERNAME=localadmin
LOCAL_ADMIN_PASSWORD=change-me
```

### Registrierung und Freischaltung (AP-16)
- Neue Benutzer registrieren sich über die öffentliche Registrierungsseite (`/register`) mit Benutzername, Anzeigename und Passwort (mind. 12 Zeichen).
- Neu registrierte Konten erhalten den Status `PENDING_APPROVAL` und können sich **nicht** anmelden, bis ein Admin sie freischaltet.
- Die Freischaltung/Ablehnung erfolgt über die Admin-Nutzerverwaltung (`/admin/users`) bzw. die Admin-API (`POST /admin/users/:id/approve` | `reject`).
- Abgelehnte Konten erhalten den Status `DISABLED`; die Unterscheidung zur Sperrung bleibt über das Audit-Log nachvollziehbar.

### Initialer Administrator (Bootstrap)
- Beim ersten Start legt die Anwendung automatisch einen initialen Admin an, sofern `LOCAL_ADMIN_USERNAME` und `LOCAL_ADMIN_PASSWORD` gesetzt sind (Audit `BOOTSTRAP_ADMIN`).
- Der Benutzername wird normalisiert (lowercase + trim); bei erneutem Start wird das Konto nicht überschrieben und das Passwort nicht geändert.
- **Sicherheitshinweis:** Der Bootstrap ist ausschließlich für lokale Entwicklung/Test vorgesehen und wird in `NODE_ENV=production` nicht ausgeführt. In Produktion sind Konten über die Admin-Oberfläche anzulegen.

### Betriebshinweise
- Beide Authentifizierungsmethoden (OIDC und lokal) können gleichzeitig aktiv sein
- Bei ausschließlicher Nutzung der lokalen Authentifizierung muss OIDC deaktiviert sein (`OIDC_ENABLED=false`)
- Wenn keine Authentifizierungsmethode aktiviert ist, startet die Anwendung nicht (Konfigurationsfehler)
- OIDC ist ein zweiter Login-Weg, der an ein bestehendes (freigeschaltetes) lokales Konto gebunden sein muss; die Bindung setzt ein Admin (`POST /admin/users/:id/oidc-binding`). OIDC provisioniert keine Konten.
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
- Nutzerverwaltung (Liste, Status-Filter, Freischaltung, Ablehnung, Sperre, Rollenzuweisung, OIDC-Bindung)
- **Systemeinstellungen (AP-17, `/admin/settings`, nur `ADMIN`):** katalogbasierte
  zentrale Konfiguration mit Gruppierung, Suche und Filtern (Quelle `.env`/`UI`/`Default`,
  „Nur ungültige UI-Werte", „Nur Neustart erforderlich"). Pro Schlüssel werden
  effektiver Wert (Secrets maskiert), Quelle, Fallback-Grund, Validierungsstatus,
  Neustartbedarf und letzter Änderungszeitpunkt/-akteur angezeigt. Aktionen:
  Setzen/Ändern (atomar validiert), Zurücksetzen auf Fallback, sicherer
  Connectivity-Test (nur für testbare Integrations-Schlüssel). Vollständiger
  Katalog: `docs/13-settings-catalog.md`.
- OIDC Konfiguration
- AI Provider
- Dokumentenspeicher
- Paperless-ngx
- Portal-Connectoren
- Feature-Flags
- Audit und Jobs

## Systemeinstellungen (AP-17)

- **Priorität:** gültiger DB-UI-Wert > validierter `.env`-Wert > Code-Default
  bzw. kontrollierte Degradation. Die Admin-UI macht Quelle, Fallback-Grund
  und effektiven Wert pro Schlüssel sichtbar.
- **Runtime vs. Neustart:** `runtime`-Werte wirken sofort (API/Worker lesen
  die zentrale Auflösung pro Aufruf). `restart`-Werte (z. B.
  `LOCAL_AUTH_MAX_ATTEMPTS`, `STORAGE_ENABLED`) werden erst beim nächsten
  Start aktiv – die UI markiert sie mit „Neustart erforderlich"; API und
  Worker vorbefüllen sie beim Boot (`preloadRestartSettingsIntoEnv`).
- **Secrets:** `AI_OPENAI_COMPAT_API_KEY`, `PAPERLESS_API_TOKEN` werden
  verschlüsselt gespeichert und in der UI nur als „gesetzt/nicht gesetzt"
  geführt; ein fehlender `SETTINGS_ENCRYPTION_KEY` führt zu fail-soft
  Preload (Warnung), nie zu Klartext-Ausgabe.
- **Connectivity-Tests:** nur für testbare Schlüssel
  (`AI_OLLAMA_BASE_URL`, `AI_OPENAI_COMPAT_BASE_URL`, `AI_OPENAI_COMPAT_API_KEY`,
  `PAPERLESS_URL`, `PAPERLESS_API_TOKEN`), 5-s-Timeout, keine Secrets im
  Ergebnis. **SSRF-Schutz:** nur öffentliche `http(s)`-Endpunkte sind
  testbar; `localhost`, private/link-local-Adressen und interne Hostnamen
  werden abgewiesen. Lokale Dienste (z. B. Ollama unter
  `http://localhost:11434`) sind daher nicht über die UI testbar – bitte
  Erreichbarkeit direkt auf dem Host prüfen.
- **Audit:** jede Änderung/Reset/Test wird revisionssicher protokolliert
  (ohne Werte/Secrets).

## Betriebsfunktionen
- Health-Checks pro Modul
- Migrationsstatus
- Queue-Status und Retry
- Provider-Connectivity-Test
- Konfigurationsvalidierung
