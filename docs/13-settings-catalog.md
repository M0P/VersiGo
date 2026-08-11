# 13. Settings-Katalog (Systemkonfiguration)

> Status: **AP-17** – Versionierter Konfigurationskatalog (Allowlist), zentrale
> Prioritätsauflösung, Admin-UI, Profil-UI, Audit und Dokumentation.
> Katalogversion: `SETTINGS_CATALOG_VERSION = 2`.

## Ziel

Jede Konfigurationsvariable der Anwendung ist inventarisiert und genau einer
Kategorie zugeordnet. Nur katalogisierte Schlüssel dürfen über die Admin-UI
gesetzt werden; unbekannte, freie `.env`-Namen oder JSON-Sammelfelder werden
strikt abgewiesen („Allowlist-basiert, kein JSON-Sammelfeld").

Die Prioritätsauflösung gilt deterministisch für **jeden** katalogisierten
Schlüssel:

1. **Gültiger, aktivierter, datenbankgestützter UI-Wert gewinnt.**
2. Fehlt, ist ungültig, deaktiviert oder nicht anwendbar → **validierter
   `.env`-Wert als Fallback.**
3. Fehlt auch dieser → **sicherer, dokumentierter Code-Default** oder die
   betroffene optionale Funktion degradiert kontrolliert.

Ein ungültiger UI-Wert aktiviert **nie** einen defekten effektiven Zustand: Er
wird ignoriert, der zuvor wirksame Zustand (ENV/Default) bleibt aktiv und die
Admin-UI zeigt `uiValueInvalid` sichtbar an.

## Kategorien

| Kategorie | Bedeutung | UI-konfigurierbar |
|---|---|---|
| `runtime` | Wird an der Verwendungsstelle **sofort** wirksam (zentrale Auflösung via `SettingsResolverService`, kein Neustart). | Ja |
| `restart` | Wird erst beim **nächsten Prozessstart** aktiv (Boot-Preload in API/Worker). Die UI zeigt „Neustart erforderlich" und stellt den Wert nie als bereits aktiv dar. | Ja |
| `secret` | Wird **verschlüsselt** persistiert, niemals im Klartext ausgegeben, geloggt oder in Audits gespeichert. Die UI zeigt nur „gesetzt/nicht gesetzt", letzten Änderungszeitpunkt und optional eine Connectivity-Prüfung. | Ja |
| `bootstrap` | **Infrastrukturkritisch – nur Environment/Compose.** Werte werden nie über die UI gespeichert, angezeigt oder überschrieben. | Nein |

## Implementierung

- Katalog: `packages/foundation/src/config/settings-catalog.ts`
- Validierung (typstrikt, von API **und** Resolver gemeinsam genutzt):
  `packages/foundation/src/config/settings-validation.ts`
- Zentrale Auflösung (UI > ENV > DEFAULT, transparente `SettingResolution` mit
  `source`, `reason`, `uiValuePresent`, `uiValueInvalid`, `uiUpdatedAt`):
  `packages/foundation/src/config/settings-resolver.service.ts`
- Boot-Preload für `restart`-Werte (fail-soft, entschlüsselt via AES-256-GCM):
  `packages/foundation/src/config/settings-preload.ts`
- Admin-API: `apps/api/src/features/system-config/` (`/admin/system-config`)
- Profil-API: `apps/api/src/features/profile/` (`/user/profile`)
- Persönliche UI-Präferenzen: `apps/api/src/features/user-preferences/`
  (versionierte Katalog-Allowlist `ui:accentColour`, `theme`; die Sprache liegt
  seit AP-21 in `users.locale` bzw. der Sitzung, siehe unten)

API und Worker verwenden exakt dieselbe Auflösung. Features lesen **niemals**
direkt `process.env` und umgehen damit keine UI-Overrides.

## Berechtigungsmatrix

| Bereich | `READ_ONLY` | `USER` | `ADMIN` |
|---|---|---|---|
| Profil & persönliche UI-Präferenzen | Kein Zugriff (API: 403) | Eigenes Profil lesen/ändern | Eigenes Profil lesen/ändern |
| Sprache (`/user/language`, AP-21) | **Nur eigene Sprache lesen/ändern, sitzungsbezogen (nie persistiert)** | Eigene Sprache lesen/ändern (persistent) | Eigene Sprache lesen/ändern (persistent) |
| Systemeinstellungen (`/admin/system-config`) | Kein Zugriff (403) | Kein Zugriff (403) | Vollzugriff auf erlaubte Schlüssel |

Die API erzwingt die Grenzen unabhängig von sichtbaren Navigationspunkten.
Kein Settings-Endpunkt gibt einem `READ_ONLY`- oder `USER`-Konto
Konfigurationswerte, Secrets, Metadaten oder Änderungsmöglichkeiten preis.

## Vollständiger Katalog

### UI-konfigurierbar (Admin-UI mit `.env`-Fallback)

#### KI-Assistent

| Schlüssel | Typ | Kategorie | Default | Validierung |
|---|---|---|---|---|
| `AI_ENABLED` | boolean | runtime | `false` | `true`/`false` |
| `AI_PROVIDER` | string | runtime | `ollama` | `ollama`, `openai-compat` |
| `AI_OLLAMA_BASE_URL` | string | runtime | `http://localhost:11434` | URL; Connectivity-Test |
| `AI_OLLAMA_MODEL` | string | runtime | `llama3` | frei |
| `AI_OPENAI_COMPAT_BASE_URL` | string | runtime | – | URL; Connectivity-Test |
| `AI_OPENAI_COMPAT_API_KEY` | string | **secret** | – | verschlüsselt; Connectivity-Test |
| `AI_OPENAI_COMPAT_MODEL` | string | runtime | `gpt-4o-mini` | frei |
| `AI_EXTRACTION_TIMEOUT_MS` | number | runtime | `60000` | 1.000–600.000 |
| `AI_MAX_RETRIES` | number | runtime | `3` | 0–10 |

#### Paperless-ngx

| Schlüssel | Typ | Kategorie | Default | Validierung |
|---|---|---|---|---|
| `PAPERLESS_ENABLED` | boolean | runtime | `false` | `true`/`false` |
| `PAPERLESS_URL` | string | runtime | – | URL; Connectivity-Test |
| `PAPERLESS_API_TOKEN` | string | **secret** | – | verschlüsselt; Connectivity-Test |

#### Connectivity / SSRF relaxation (BugFix-06, opt-in)

| Key | Type | Category | Default | Validation |
|---|---|---|---|---|
| `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` | boolean | runtime | `false` | `true`/`false`; strictly opt-in |
| `CONNECTIVITY_ALLOW_SELF_SIGNED` | boolean | runtime | `false` | `true`/`false`; strictly opt-in |

Security note: both flags are deliberately **off by default** (strict SSRF
protection: only public `http(s)` endpoints). They apply to the connectivity
test, the OIDC discovery/callback, the AI providers (Ollama /
OpenAI-compatible) and Paperless-ngx. The cloud metadata address
`169.254.169.254` (and its IPv6/IPv4-mapped forms) stays blocked **always**,
even with `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS=true`. OIDC discovery reads
the flags once at boot – enabling them for a LAN OIDC provider requires a
restart (see the "restart required" hint in the UI).

#### Authentifizierung

| Schlüssel | Typ | Kategorie | Default | Validierung |
|---|---|---|---|---|
| `LOCAL_AUTH_MAX_ATTEMPTS` | number | **restart** | `5` | 1–100; Neustart nötig |
| `LOCAL_AUTH_RATE_LIMIT_WINDOW_MS` | number | **restart** | `900000` | 1.000–86.400.000; Neustart nötig |

#### Speicher

| Schlüssel | Typ | Kategorie | Default | Validierung |
|---|---|---|---|---|
| `STORAGE_ENABLED` | boolean | **restart** | `false` | `true`/`false`; Neustart nötig |

### Environment-only (Bootstrap/Infrastruktur – niemals über die UI)

Aus Sicherheits- und Infrastrukturgründen ausschließlich über Environment/Compose
setzbar; die Admin-API lehnt diese Schlüssel ab (`ForbiddenException`):

| Schlüssel | Gruppe | Begründung |
|---|---|---|
| `NODE_ENV` | Infrastruktur | Laufzeitumgebung |
| `APP_PORT`, `WEB_PORT` | Infrastruktur | Port-Bindings |
| `CORS_ORIGINS` | Infrastruktur | Netzwerk/Trust-Grenze |
| `TRUST_PROXY` | Infrastruktur | Reverse-Proxy-Vertrauen |
| `COOKIE_SECURE` | Infrastruktur | Session-Cookie Secure-Flag (leer = pro Request "auto", Secure nur über HTTPS; BugFix-14) |
| `DATABASE_URL`, `REDIS_URL` | Infrastruktur | Verbindungsstrings |
| `DOCUMENTS_STORAGE_PATH` | Infrastruktur | Dateisystempfad |
| `SETTINGS_ENCRYPTION_KEY` | Infrastruktur | **Root-Secret** (AES-256-GCM) |
| `SESSION_SECRET` | Infrastruktur | **Session-Secret** |
| `NEXT_PUBLIC_API_BASE_URL` | Infrastruktur | Browser-Auto-Erkennung (leer = Default; BugFix-14) |
| `APP_VERSION`, `NEXT_PUBLIC_APP_VERSION` | Infrastruktur | Laufzeit-Versionskennung (`/health`, `/ready`, Web-Footer; BugFix-11/R7) |
| `NEXT_ALLOWED_DEV_ORIGINS` | Infrastruktur | Dev-HMR-Origins |
| `LOCAL_AUTH_ENABLED`, `LOCAL_ADMIN_USERNAME`, `LOCAL_ADMIN_PASSWORD` | Authentifizierung | Boot-/Fail-Fast-Logik |
| `OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CALLBACK_URL` | Authentifizierung | Boot-/Fail-Fast-Logik, Client-Secret |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Speicher | Infrastruktur-Secrets |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Speicher | Infrastruktur-Secrets |
| `WORKER_HEALTH_PORT` | Worker Health | Liveness-Port (intern, nicht publiziert) |
| `WORKER_HEARTBEAT_INTERVAL_MS` | Worker Health | Heartbeat-Intervall (Grundlage für `GET /ready`) |
| `WORKER_HEARTBEAT_TIMEOUT_MS` | Worker Health | Heartbeat-Timeout (`worker: down` in `GET /ready`) |

## Persönliche Profileinstellungen (versionierte Allowlist)

- `User.displayName` (Profil) – über `PATCH /user/profile` (1–100 Zeichen).
- `User.locale` – **Sprachcode** (`en` | `de`), Default `en` (globaler
  Standard). Seit AP-21 **nicht** mehr über `PATCH /user/profile`, sondern
  über den Sprachen-Endpunkt `/user/language` verwaltet (siehe unten).
- `UserPreference.key` – persönliche UI-Präferenzen, versionierter Katalog:
  - `ui:accentColour` – Hex-Farbwert (#rrggbb) für die Akzentfarbe.
  - `theme` – `light` | `dark` | `system`.
  - (Die frühere Präferenz `language` ist seit AP-21 obsolet und wurde per
    Migration entfernt; Sprache liegt jetzt in `users.locale` bzw. der Sitzung.)
- Änderungen am Profil sind auf den aktuellen Nutzer begrenzt. `READ_ONLY`
  erhält für das Profil 403 – **ausgenommen** der Sprachen-Endpunkt.

## Sprache (AP-21: Multi-Language Support)

- Endpunkt: `GET`/`PUT /user/language` (alle authentifizierten Rollen,
  inkl. `READ_ONLY`).
- Angefragt/gesetzt wird ein Sprachcode aus `en` | `de`; Englisch ist der
  globale Standard. Ungültige Werte liefern `400`, unbekannte Locale-Werte
  (z. B. Altbestand `fr-FR`) fallen sicher auf `en` zurück.
- **`USER`/`ADMIN`:** `users.locale` wird persistiert (`persistence:
  "persistent"`); Auflösung: Konto → Browserpräferenz (Accept-Language) →
  `en`.
- **`READ_ONLY`:** Nur die eigene Sprache, **ausschließlich sitzungsbezogen**
  (`persistence: "session"`, `express-session`-Feld `language`); niemals in
  der Datenbank, kein Audit, kein Verlauf. Auflösung: Sitzung →
  Browserpräferenz → `en`.
- Es gibt **keine systemweite Sprache** und keine Übersetzungsverwaltung in
  der UI – die Kataloge liegen im Web-Repo (`apps/web/src/i18n/locales/`).

## Admin-UI-Verhalten (`/admin/settings`)

- Gruppiert nach Katalog-Gruppe, mit Suche (Schlüssel/Gruppe/Beschreibung) und
  Filtern: Quelle (`UI` / `.env` / `Default`), „Nur ungültige UI-Werte",
  „Nur Neustart erforderlich".
- Pro Schlüssel sichtbar: effektiver Wert (Secrets maskiert), Quelle als
  Badge, Fallback-Grund, Validierungsstatus, Neustartbedarf, letzter
  Änderungszeitpunkt/-akteur (soweit datenschutzkonform) und ggf.
  Connectivity-Status.
- Aktionen: Setzen/Ändern (atomar validiert), Zurücksetzen auf Fallback
  (löscht die DB-Zeile), sicherer Connectivity-Test (nur für als testbar
  markierte Schlüssel, 5 s Timeout, ohne Secret-Preisgabe).
- **Connectivity-Test-Beschränkung (SSRF-Schutz, BugFix-06):** By default the
  test only allows **public `http(s)` endpoints**. Local/private addresses and
  hostnames (`localhost`, `*.local`, `*.internal`, 127.0.0.0/8, 10/8,
  172.16/12, 192.168/16, 100.64/10, 169.254/16, IPv6 ULA/Link-Local) are
  rejected – even if they are the configured value. The guard resolves DNS
  names and blocks lookups into private ranges (simple DNS-rebinding
  protection). Local services (e.g. Ollama under `http://localhost:11434`,
  the catalog default) are therefore **not testable via the UI** unless the
  opt-in is enabled; check their reachability directly on the host
  (`curl` / health check).
- With `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS=true` the test (and the OIDC/AI/
  Paperless clients) accept local/private endpoints for LAN deployments
  (e.g. Paperless-ngx on `http://192.168.24.8:8010`, Ollama on localhost).
  The cloud metadata address `169.254.169.254` (IPv4, IPv6 `fd00:ec2::254`
  and the IPv4-mapped IPv6 forms `::ffff:169.254.169.254` /
  `::ffff:a9fe:a9fe`) remains blocked **always** – it is the primary SSRF
  target and an end user testing local services never needs it.
- With `CONNECTIVITY_ALLOW_SELF_SIGNED=true` the connectivity test tolerates
  self-signed/incomplete TLS certificates **for that test request only**
  (`rejectUnauthorized: false` on the request agent – never globally). Both
  flags are explicit opt-ins; the strict default is preserved.
- Bootstrap-Schlüssel erscheinen nicht in der UI und sind über die API
  unzugänglich.

## Audit

- `SYSTEM_CONFIG_UPSERTED` / `SYSTEM_CONFIG_RESET` pro geändertem Schlüssel,
  revisionssicher, **ohne Werte oder Secrets** (`diffJson: { key, redacted: true }`).
- `PROFILE_UPDATED` bei Profiländerung mit Feldnamen, ohne Werte.
- Feature-Flag-Änderungen und Connectivity-Tests werden ebenfalls auditiert;
  Connectivity-Tests enthalten keine Secrets.

## Persistenz & Verschlüsselung

- UI-Werte: Tabelle `GlobalIntegrationSetting` (`key` unique, `valueEncrypted`
  für Secrets, `valuePlain` für Nicht-Secrets, `updatedByUserId` als
  Audit-Akteur mit FK `ON DELETE SET NULL`).
- Secrets werden mit **AES-256-GCM** verschlüsselt
  (`SETTINGS_ENCRYPTION_KEY`, 64 Hex-Zeichen, `openssl rand -hex 32`).
- **Hinweis (m11, Entwicklungsstand):** Vor dem AP-17-M3-Fix über die
  Legacy-Endpunkte angelegte Zeilen für Katalog-Secrets mit `isSecret=false`
  könnten noch als Klartext in `valuePlain` liegen. Es gibt keine
  automatische Nachverschlüsselung (bewusst: dev-only, keine
  Produktionsdaten; alle neuen Schreibpfade erzwingen das Katalog-Secret-
  Flag). Bei Bedarf einmalig per Skript nachziehen: `valuePlain` lesen,
  verschlüsselt in `valueEncrypted` schreiben, `valuePlain` leeren.
- Ein fehlender/ungültiger `SETTINGS_ENCRYPTION_KEY` führt zum fail-soft
  Preload (Warnung, kein Absturz); Secrets werden dann nicht in `process.env`
  vorbefüllt.
