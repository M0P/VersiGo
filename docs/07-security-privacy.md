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
- OIDC Login (optional, via `OIDC_ENABLED`)
- Lokale Benutzername/Passwort-Anmeldung (optional, via `LOCAL_AUTH_ENABLED`)
- Beide Authentifizierungsmethoden sind unabhängig konfigurierbar
- Wenn keine Authentifizierungsmethode aktiviert ist, wird die Anwendung mit einem Konfigurationsfehler gestartet
- CSRF-Schutz, sichere Cookies, Session Rotation
- Mandantentrennung auf Household-Ebene plus objektbezogene Freigaben

### Passwort-Handling (lokale Anmeldung)
- Passwörter werden mit **bcrypt** (Kostenfaktor 12) gehasht, mit eingebautem, eindeutigem Salt pro Passwort
- Plaintext-Passwörter werden niemals gespeichert, geloggt oder in API-Antworten ausgegeben
- Der Login-Identifier wird vor dem Speichern normalisiert (lowercase, getrimmt), um case-insensitive Eindeutigkeit zu gewährleisten
- Fehlgeschlagene Anmeldeversuche geben eine generische Fehlermeldung zurück, die nicht verrät, ob der Benutzername existiert

### Brute-Force-Schutz
- Fehlgeschlagene Login-Versuche werden pro IP-Adresse in Redis gezählt
- Nach einer konfigurierbaren Anzahl von Versuchen (Standard: 5) innerhalb eines Zeitfensters (Standard: 15 Minuten) wird die IP vorübergehend gesperrt
- Der Zähler wird nach erfolgreichem Login zurückgesetzt
- Bei Redis-Ausfall wird der Zugriff nicht blockiert (Fail-Open)

### Audit (lokale Anmeldung)
- Erfolgreiche und fehlgeschlagene lokale Login-Versuche werden auditierbar erfasst
- Sensitive Werte (Passwörter, Tokens, Session-IDs) werden nicht in Audit-Events geloggt
- Bei fehlgeschlagenen Versuchen wird der Benutzername nicht im Audit-Log aufgezeichnet

## Datenschutz
- AI-Nutzung nur nach expliziter Aktivierung.
- Dokumente können von AI-Verarbeitung ausgeschlossen werden.
- Export- und Löschfunktionen für personenbezogene Daten.
- Vollständiges Audit für Zugriff auf sensible Dokumente.

## Secrets
- Nur technische Bootstrap-Secrets in Docker-Umgebung.
- API-Keys im verschlüsselten Settings-Store in der Datenbank.
- Rotation über Admin-UI.
