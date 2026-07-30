# Admin und Betrieb

## Docker-Compose Prinzipien
- Möglichst wenige Pflichtvariablen.
- Erststart-Assistent im Admin-UI für Basis-Setup.
- Integrationen können nach dem Start vollständig im UI eingerichtet werden.

## Minimale Umgebungsvariablen
- `APP_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `BOOTSTRAP_ADMIN_EMAIL` oder OIDC Bootstrap-Regel
- optional `STORAGE_ENDPOINT` bei S3

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
