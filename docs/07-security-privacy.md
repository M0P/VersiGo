# Sicherheit und Datenschutz

## Grundsätze
- Datenschutzfreundliche Voreinstellungen.
- Verschlüsselung ruhender Dateien optional, für produktiven Einsatz empfohlen.
- TLS-Termination via Reverse Proxy außerhalb oder vor dem Stack.
- Least-Privilege für Rollen und Freigaben.

## Docker Compose Sicherheit

### Secrets
- Secrets werden ausschließlich über Umgebungsvariablen in `.env` übergeben.
- Die `.env`-Datei wird nicht versioniert (in `.gitignore`).
- Platzhalter-Werte in `.env.example` sind als `change-me` gekennzeichnet.
- Keine Secrets in Code, Images, Logs oder Testdaten.
- Der `migration`-Service erhält nur die für Migrationen notwendigen Variablen.

### Netzwerk
- Alle Dienste kommunizieren über ein internes Bridge-Netzwerk `insura-internal`.
- Nur öffentliche Ports: Web (3000), API (3001).
- Datenbank (5432), Redis (6379) und MinIO (9000, 9001) sind standardmäßig nicht nach außen exponiert.
- Entwicklungsoverride (`docker-compose.override.yml`) kann interne Ports für lokale Tools öffnen.

### Container-Privilegien
- Laufzeitcontainer verwenden einen nicht-root Benutzer (`appuser`).
- PostgreSQL, Redis und MinIO laufen mit deren integrierten nicht-root Benutzern.
- Container haben keine zusätzlichen Capabilities.

### Testdaten-Isolation
- Testdienste in `docker-compose.test.yml` verwenden dedizierte Volumes und Netzwerke.
- Produktionsvolumes werden von Tests nicht berührt.

### Reverse Proxy / TLS
- Der Compose-Stack stellt kein TLS bereit.
- TLS-Termination erfolgt durch einen vorgelagerten Reverse Proxy (z. B. Caddy, Traefik, nginx).
- Cookie `Secure`-Flag wird nur in `NODE_ENV=production` gesetzt.
- Für lokale Entwicklung ist HTTP ausreichend.

## Zugriffsschutz
- OIDC Login
- Lokale Fallback-Admin-Anmeldung nur für Bootstrap optional und standardmäßig deaktiviert
- CSRF-Schutz, sichere Cookies, Session Rotation
- Mandantentrennung auf Household-Ebene plus objektbezogene Freigaben

## Datenschutz
- AI-Nutzung nur nach expliziter Aktivierung.
- Dokumente können von AI-Verarbeitung ausgeschlossen werden.
- Export- und Löschfunktionen für personenbezogene Daten.
- Vollständiges Audit für Zugriff auf sensible Dokumente.

## Secrets
- Nur technische Bootstrap-Secrets in Docker-Umgebung.
- API-Keys im verschlüsselten Settings-Store in der Datenbank.
- Rotation über Admin-UI.
