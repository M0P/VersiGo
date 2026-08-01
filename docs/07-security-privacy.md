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
- OIDC Login (optional, via `OIDC_ENABLED`, gebunden an ein lokales Konto – kein Provisioning)
- Lokale Benutzername/Passwort-Anmeldung (optional, via `LOCAL_AUTH_ENABLED`)
- Beide Authentifizierungsmethoden sind unabhängig konfigurierbar
- Wenn keine Authentifizierungsmethode aktiviert ist, wird die Anwendung mit einem Konfigurationsfehler gestartet
- CSRF-Schutz, sichere Cookies, Session Rotation
- Mandantentrennung auf Household-Ebene plus objektbezogene Freigaben

### Globale Rollen (AP-16/ADR-007)
- Genau drei globale Rollen, serverseitig in Guards und Datenabfragen durchgesetzt:
  - `ADMIN` – Nutzer- und Systemverwaltung
  - `USER` – volle Verwaltung eigener Verträge und des eigenen Profils
  - `READ_ONLY` – ausschließlich Lesen explizit freigegebener Verträge
- `HouseholdMembership` dient nur noch der Mandantentrennung; Berechtigungen entkoppelt über `users.role`
- **Schreibzugriff (`USER`) folgt der Household-Mitgliedschaft:** Innerhalb eines Households verwalten Mitglieder die Verträge des Households gemeinsam (Family-Sharing-Modell, ADR-007). „Eigene Verträge" ist damit als „Verträge des eigenen Households" zu lesen; `ownerUserId` ist Provenienz-/Audit-Information, keine Zugriffsgrenze. Fremde Households bleiben durch die Mandantentrennung ausgeschlossen.
- `READ_ONLY` erhält ohne passende explizite `READ`-Freigabe keinen Zugriff – auch nicht auf eigene historische oder Household-Daten
- Letzter-Admin-Schutz: Der letzte aktive `ADMIN` kann weder gesperrt noch herabgestuft werden (serialisierbare Transaktion)

### Registrierung und Freischaltung (AP-16)
- Neue lokale Konten werden mit Status `PENDING_APPROVAL` angelegt und können sich nicht anmelden (lokaler wie OIDC-Login abgewiesen)
- Nur ein `ADMIN` schaltet Konten frei (`USER_APPROVED`) oder lehnt sie ab (`USER_REJECTED` → `DISABLED`)
- Antworttexte der Registrierung verraten weder Freischaltstatus noch andere Kontenattribute. Bewusste, eng begrenzte Ausnahme: Ein bereits vergebener **selbst gewählter Benutzername** wird als `409` gemeldet (ADR-007, Entscheidung 4a), damit der Nutzer zu einem freien Namen wechseln kann
- `POST /auth/register` ist per-IP rate-limitiert (eigener Redis-Zähler, getrennt vom Login-Zähler), damit die Admin-Freischalt-Warteschlange nicht durch Massen-Registrierungen überflutet werden kann

### Initialer Administrator (Bootstrap)
- `LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD` legen beim ersten Start einen initialen Admin an (Audit `BOOTSTRAP_ADMIN`)
- Nur in Entwicklungs-/Testumgebungen; in `NODE_ENV=production` wird kein Bootstrap ausgeführt
- Keine automatischen Default-Zugangsdaten; Passwort wird nie überschrieben oder geändert

### Passwort-Handling (lokale Anmeldung)
- Passwörter werden mit **bcrypt** (Kostenfaktor 12) gehasht, mit eingebautem, eindeutigem Salt pro Passwort
- Plaintext-Passwörter werden niemals gespeichert, geloggt oder in API-Antworten ausgegeben
- Der Login-Identifier wird vor dem Speichern normalisiert (lowercase, getrimmt), um case-insensitive Eindeutigkeit zu gewährleisten
- Fehlgeschlagene Anmeldeversuche geben eine generische Fehlermeldung zurück, die nicht verrät, ob der Benutzername existiert

### Brute-Force-Schutz
- Fehlgeschlagene Login-Versuche werden pro IP-Adresse in Redis gezählt
- Nach einer konfigurierbaren Anzahl von Versuchen (Standard: 5) innerhalb eines Zeitfensters (Standard: 15 Minuten) wird die IP vorübergehend gesperrt
- Der Zähler wird nach erfolgreichem Login zurückgesetzt
- Auch Registrierungsversuche (`POST /auth/register`) werden pro IP getrennt gezählt und begrenzt; fehlgeschlagene (409) wie erfolgreiche Registrierungen erhöhen den Zähler, ein Reset findet dort nicht statt
- Bei Redis-Ausfall wird der Zugriff nicht blockiert (Fail-Open)
- `TRUST_PROXY`: Nur hinter einem vertrauenswürdigen Reverse-Proxy auf `true` setzen, sonst fallen `req.ip` und damit die per-IP-Rate-Limits auf die Proxy-IP zurück

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
