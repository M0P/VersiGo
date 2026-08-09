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
- Alle Dienste kommunizieren über ein internes Bridge-Netzwerk `versigo-internal`.
- Nur öffentliche Ports: Web (3000), API (3001).
- Datenbank (5432), Redis (6379) und MinIO (9000, 9001) sind standardmäßig nicht nach außen exponiert.
- Der Worker-Liveness-Port (Standard `WORKER_HEALTH_PORT` 3100) ist **nicht** an den Host gebunden – er ist nur innerhalb des Compose-Netzes erreichbar (Grundlage des Compose-Healthchecks und der Smoke-Prüfung im Container).
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
- Cookie `Secure`-Flag wird standardmäßig nur in `NODE_ENV=production` gesetzt (Konfiguration `COOKIE_SECURE`, Default abgeleitet aus `NODE_ENV`).
- `COOKIE_SECURE` nur explizit setzen, wenn die API kontrolliert über reines HTTP bedient wird (z. B. hinter einem TLS-terminierenden Reverse-Proxy oder in einer kontrollierten internen Installation ohne TLS).
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
- `LOCAL_AUTH_ENABLED=true` plus `LOCAL_ADMIN_USERNAME`/`LOCAL_ADMIN_PASSWORD` legen beim ersten Start einen initialen Admin an (Audit `BOOTSTRAP_ADMIN`)
- In `NODE_ENV=production` ist `LOCAL_AUTH_ENABLED` per Default deaktiviert: Ein Admin wird dort **niemals automatisch** angelegt, sondern nur bei ausdrücklicher Konfiguration (AP-20); das `.env.example`-Platzhalter-Passwort wird in Produktion abgelehnt
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
- Auch fehlgeschlagene Verifikationen des aktuellen Passworts bei `POST /auth/change-password` werden pro IP in einem separaten Scope (`change-password`) gezählt und begrenzt; der Zähler wird nach erfolgreicher Änderung zurückgesetzt
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

## Datenschutz-Praxis (AP-19, GDPR)

### Export (`GET /privacy/export`)
- Nur die **eigene** Session-Identität (`@CurrentUser`), niemals Pfad- oder
  Query-Parameter → kein IDOR.
- Rollengrenze: `USER`/`ADMIN` (Rollenhierarchie); `READ_ONLY` erhält 403.
- **Redaktion:** Der Export enthält nie Passwort-Hashes, verschlüsselte
  Settings-Werte, Speicherpfade/`storageRef`, Portal-URLs oder
  Portal-Zugangsdaten (nur `providerKey`/Sync-Metadaten), Binärdateien oder
  rohe AI-Payloads. Keine Konfigurationswerte oder Secrets.

### Sprache (AP-21)
- Der Sprachen-Endpunkt `/user/language` ist die **einzige** Freigabe für
  `READ_ONLY` über die Profil-Grenze hinaus: Er darf ausschließlich die
  **eigene** Sprache lesen/ändern.
- `READ_ONLY`-Sprachwahl wird **niemals persistiert** (nur
  `express-session`), erzeugt **keine** Audit-Einträge und hinterlässt keinen
  Verlauf – Session-Ende = Sprache verworfen.
- Es gibt keine systemweite Sprache und keine Übersetzungsverwaltung über die
  API; Browserpräferenzen werden nur als Fallback ausgewertet (kein
  Tracking, kein Persistieren von Header-Daten).

### Kontolöschung (`DELETE /privacy/account`)
- Letzter-Admin-Schutz: Der letzte aktive `ADMIN` kann sein Konto nicht
  löschen (409 `ConflictException`), um einen System-Lockout zu verhindern.
- **Audit vor der Löschung:** `PRIVACY_ACCOUNT_DELETED` wird *vor* dem
  User-Delete geschrieben; `actorUserId` wird danach per `ON DELETE SET NULL`
  neutralisiert, der Eintrag bleibt als revisionssicherer Trail erhalten.
- Löschsemantik (eine Transaktion): eigene Policen kaskadieren
  (versicherte Personen, Kosten, Dokumente, Portal-Links, AI-Jobs) →
  Household-Mitgliedschaften auflösen → Household nur löschen, wenn weder
  Mitglieder noch Policen verbleiben → User löschen.
- **Physische Dateibereinigung nach DB-Commit:** Nur Dateien innerhalb des
  Storage-Roots werden entfernt (Path-Traversal-Schutz); fehlende Dateien
  (ENOENT) werden toleriert, Fehler werden geloggt und werfen nie.

## Secrets
- Nur technische Bootstrap-Secrets in Docker-Umgebung.
- API-Keys im verschlüsselten Settings-Store in der Datenbank.
- Rotation über Admin-UI.

## Zentrale Systemkonfiguration (AP-17)

### Verschlüsselung
- UI-gesetzte Secrets werden mit **AES-256-GCM** verschlüsselt
  (`SETTINGS_ENCRYPTION_KEY`, 64 Hex-Zeichen) in
  `GlobalIntegrationSetting.valueEncrypted` persistiert.
- Secrets werden **niemals** im Klartext zurückgegeben, geloggt oder in
  Audit-Diffs gespeichert. Die API liefert nur `secretSet` (gesetzt/nicht
  gesetzt); die UI zeigt ausschließlich „••••••••" bzw. „Nicht gesetzt".
- `.env`-Secret-Werte werden nie vollständig oder als Teilwerte offenbart;
  Konfigurationsmetadaten enthalten keine Infrastruktur- oder Secret-Leaks.

### Allowlist und Infrastruktur-Grenze
- Nur katalogisierte Schlüssel sind setzbar (versionierte Allowlist, siehe
  `docs/13-settings-catalog.md`). Unbekannte `.env`-Namen/JSON werden
  abgewiesen.
- **Bootstrap-Schlüssel** (DB/Redis-Verbindungsstrings, Root-Secrets,
  Session-/Verschlüsselungs-Schlüssel, Ports, Pfade, TLS/Proxy,
  Auth-Boot-Flags) sind ausschließlich Environment/Compose: nie über die UI
  speicher-, anzeige- oder überschreibbar (API: `ForbiddenException`).

### Berechtigungsgrenzen
- Systemeinstellungen: nur `ADMIN` (RolesGuard, serverseitig erzwungen).
- Profil/Präferenzen: nur `USER`/`ADMIN`, ausschließlich auf den eigenen
  Nutzer bezogen; `READ_ONLY` erhält über direkte Anfragen keinerlei Werte
  (403).

### Sichere Connectivity-Tests
- Nur für als testbar markierte Schlüssel, mit 5-s-Abort und ohne Preisgabe
  geheimer Werte. `HTTP < 500` gilt als „erreichbar" (auch 401/403 beweisen
  Laufzeit, ohne Response-Inhalte zu verarbeiten).

### Audit-Redaction
- `SYSTEM_CONFIG_UPSERTED`/`SYSTEM_CONFIG_RESET`: `diffJson` enthält nur
  `{ key, redacted: true }` – nie Werte oder Secrets.
- `PROFILE_UPDATED`: nur Feldnamen.

## Portal-Zugangsdaten (AP-18)

### Verschlüsselung
- Optionale Portal-Zugangsdaten (`portalUsername`, `portalPassword`) werden
  **AES-256-GCM** verschlüsselt in `PortalAccountLink.credentialsEncrypted`
  persistiert (gleicher Schlüssel-Transport wie die Systemeinstellungen,
  `SETTINGS_ENCRYPTION_KEY`).
- Es wird **nie** Klartext gespeichert, geloggt, im Audit-Diff oder in
  API-Antworten ausgegeben. Antworten enthalten ausschließlich
  `credentialsSet: true/false`; `credentialsEncrypted` wird von der
  API-Schicht strikt entfernt.
- Audit-Events für Portal-Links (`CREATE`/`UPDATE`) enthalten nur
  Feldnamen und `credentialsSet` – niemals Zugangsdaten-Werte.
- `credentials: null` löscht gespeicherte Zugangsdaten (Update);
  `credentials: {}` wird mit einem Validierungsfehler abgewiesen
  (mindestens ein Feld erforderlich).

### Zugriffsregeln
- Portal-Connector-Endpunkte (`/portal-connectors/*`) sind reine
  Lese-Endpunkte ohne Household-Bezug und für alle authentifizierten
  Rollen (`READ_ONLY`, `USER`, `ADMIN`) zugänglich.
- Portal-Link-Verwaltung bleibt vollständig an die Household-Isolation
  des Policy-Registry-Slices gebunden.
