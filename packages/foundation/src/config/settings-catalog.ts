/**
 * Versioned settings catalog (allowlist) for the central
 * system configuration (AP-17).
 *
 * The catalog inventories EVERY configuration variable of the application
 * (AppConfig schema, Compose, `.env.example`) and assigns it to exactly
 * one category. Only catalogued keys may be set via the admin UI;
 * unknown or free `.env` names are strictly rejected
 * ("allowlist-based, no JSON grab-bag field").
 *
 * Categories:
 * - `runtime`  : UI-configurable, takes effect immediately at the place
 *                of use (central resolution via SettingsResolverService).
 * - `restart`  : UI-configurable, becomes active only at the next process
 *                start (boot preload in API/worker); the UI shows
 *                "restart required" and never presents the value as
 *                already active.
 * - `secret`   : UI-configurable, persisted encrypted, never exposed in
 *                plaintext, logged or stored in audits.
 * - `bootstrap`: Infrastructure-critical – environment/Compose only. Values
 *                are never stored, displayed or overwritten via the UI.
 */

export type SettingsCategory = 'runtime' | 'restart' | 'secret' | 'bootstrap';

export type SettingsValueType = 'boolean' | 'number' | 'string';

export type SettingsPermission = 'ADMIN';

export interface SettingDefinition {
  /** Unique catalog key (identical to the env variable name). */
  key: string;
  /** Env variable name as fallback source. */
  envVar: string;
  category: SettingsCategory;
  type: SettingsValueType;
  /** UI group under which the key is grouped. */
  group: string;
  /** Visible, comprehensible description (German, for admin UI + docs). */
  description: string;
  /** Safe, documented code default. If missing, the feature degrades. */
  defaultValue?: string | number | boolean;
  /** For string values: allowed choices (e.g. provider names). */
  allowedValues?: readonly string[];
  /** Numeric lower/upper bounds. */
  min?: number;
  max?: number;
  /** Optional validation hint for the UI. */
  validationHint?: string;
  /**
   * Secret-category key that nevertheless must be preloaded into
   * `process.env` during boot (construction-time consumers, e.g. the
   * OIDC strategy). Only for category `secret`; restart category is
   * always preloaded.
   */
  bootActivation?: boolean;
  /** Whether a safe connectivity check exists (only for the respective integration). */
  connectivityTestable: boolean;
  /** Permission requirement (uniform: global ADMINS only). */
  permission: SettingsPermission;
}

export const SETTINGS_CATALOG_VERSION = 2;

/**
 * Complete configuration catalog. Sorted by group, then key.
 * Verified in tests against the AppConfig schema keys and the docs.
 */
export const SETTINGS_CATALOG: readonly SettingDefinition[] = [
  // ====================== KI-Assistent ======================
  {
    key: 'AI_ENABLED',
    envVar: 'AI_ENABLED',
    category: 'runtime',
    type: 'boolean',
    group: 'KI-Assistent',
    description:
      'Schaltet die KI-Funktionen (Vertragsdaten-Extraktion und Deckungs-Zusammenfassung) ein oder aus. ' +
      'Aenderungen wirken sofort, ohne Neustart.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'AI_PROVIDER',
    envVar: 'AI_PROVIDER',
    category: 'runtime',
    type: 'string',
    group: 'KI-Assistent',
    description: 'Aktiver KI-Provider: lokal via Ollama oder ein OpenAI-kompatibler Endpunkt.',
    defaultValue: 'ollama',
    allowedValues: ['ollama', 'openai-compat'],
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'AI_OLLAMA_BASE_URL',
    envVar: 'AI_OLLAMA_BASE_URL',
    category: 'runtime',
    type: 'string',
    group: 'KI-Assistent',
    description: 'Basis-URL des Ollama-Servers (z. B. http://localhost:11434).',
    defaultValue: 'http://localhost:11434',
    validationHint: 'Vollstaendige URL inklusive Schema, ohne Pfad.',
    connectivityTestable: true,
    permission: 'ADMIN',
  },
  {
    key: 'AI_OLLAMA_MODEL',
    envVar: 'AI_OLLAMA_MODEL',
    category: 'runtime',
    type: 'string',
    group: 'KI-Assistent',
    description: 'Ollama-Modellname, der fuer Extraktion und Zusammenfassung verwendet wird.',
    defaultValue: 'llama3',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'AI_OPENAI_COMPAT_BASE_URL',
    envVar: 'AI_OPENAI_COMPAT_BASE_URL',
    category: 'runtime',
    type: 'string',
    group: 'KI-Assistent',
    description:
      'Basis-URL eines OpenAI-kompatiblen Endpunkts (z. B. https://api.example.com/v1). ' +
      'Nur relevant, wenn AI_PROVIDER=openai-compat ist.',
    connectivityTestable: true,
    permission: 'ADMIN',
  },
  {
    key: 'AI_OPENAI_COMPAT_API_KEY',
    envVar: 'AI_OPENAI_COMPAT_API_KEY',
    category: 'secret',
    type: 'string',
    group: 'KI-Assistent',
    description:
      'API-Schluessel des OpenAI-kompatiblen Endpunkts. Wird verschluesselt gespeichert, ' +
      'niemals im Klartext angezeigt oder protokolliert.',
    connectivityTestable: true,
    permission: 'ADMIN',
  },
  {
    key: 'AI_OPENAI_COMPAT_MODEL',
    envVar: 'AI_OPENAI_COMPAT_MODEL',
    category: 'runtime',
    type: 'string',
    group: 'KI-Assistent',
    description: 'Modellname des OpenAI-kompatiblen Endpunkts.',
    defaultValue: 'gpt-4o-mini',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'AI_EXTRACTION_TIMEOUT_MS',
    envVar: 'AI_EXTRACTION_TIMEOUT_MS',
    category: 'runtime',
    type: 'number',
    group: 'KI-Assistent',
    description: 'Timeout in Millisekunden fuer einen einzelnen KI-Aufruf.',
    defaultValue: 60_000,
    min: 1_000,
    max: 600_000,
    validationHint: 'Zwischen 1.000 und 600.000 ms.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'AI_MAX_RETRIES',
    envVar: 'AI_MAX_RETRIES',
    category: 'runtime',
    type: 'number',
    group: 'KI-Assistent',
    description: 'Maximale Anzahl automatischer Wiederholungen fehlgeschlagener Extraktionen.',
    defaultValue: 3,
    min: 0,
    max: 10,
    validationHint: 'Zwischen 0 und 10.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },

  // ====================== Paperless-ngx ======================
  {
    key: 'PAPERLESS_ENABLED',
    envVar: 'PAPERLESS_ENABLED',
    category: 'runtime',
    type: 'boolean',
    group: 'Paperless-ngx',
    description:
      'Aktiviert die Anbindung an einen Paperless-ngx-Server (Dokumenten-Synchronisation). ' +
      'Aenderungen wirken sofort, ohne Neustart.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'PAPERLESS_URL',
    envVar: 'PAPERLESS_URL',
    category: 'runtime',
    type: 'string',
    group: 'Paperless-ngx',
    description: 'Basis-URL des Paperless-ngx-Servers (inklusive Schema).',
    validationHint: 'Vollstaendige URL inklusive Schema, ohne Pfad.',
    connectivityTestable: true,
    permission: 'ADMIN',
  },
  {
    key: 'PAPERLESS_API_TOKEN',
    envVar: 'PAPERLESS_API_TOKEN',
    category: 'secret',
    type: 'string',
    group: 'Paperless-ngx',
    description:
      'API-Token des Paperless-ngx-Kontos. Wird verschluesselt gespeichert, niemals im ' +
      'Klartext angezeigt oder protokolliert.',
    connectivityTestable: true,
    permission: 'ADMIN',
  },

  // ====================== Authentifizierung ======================
  {
    key: 'LOCAL_AUTH_MAX_ATTEMPTS',
    envVar: 'LOCAL_AUTH_MAX_ATTEMPTS',
    category: 'restart',
    type: 'number',
    group: 'Authentifizierung',
    description:
      'Maximale fehlgeschlagene Anmeldeversuche pro IP und Zeitfenster, bevor das ' +
      'Rate-Limit greift. Wird beim naechsten Start aktiv.',
    defaultValue: 5,
    min: 1,
    max: 100,
    validationHint: 'Zwischen 1 und 100.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'LOCAL_AUTH_RATE_LIMIT_WINDOW_MS',
    envVar: 'LOCAL_AUTH_RATE_LIMIT_WINDOW_MS',
    category: 'restart',
    type: 'number',
    group: 'Authentifizierung',
    description:
      'Rate-Limit-Zeitfenster in Millisekunden (Standard: 15 Minuten). ' +
      'Wird beim naechsten Start aktiv.',
    defaultValue: 900_000,
    min: 1_000,
    max: 86_400_000,
    validationHint: 'Zwischen 1.000 und 86.400.000 ms.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },

  // ====================== Speicher ======================
  {
    key: 'STORAGE_ENABLED',
    envVar: 'STORAGE_ENABLED',
    category: 'restart',
    type: 'boolean',
    group: 'Speicher',
    description:
      'Aktiviert den optionalen S3/MinIO-Speicher fuer Dokumente. Wird beim naechsten ' +
      'Start aktiv; die Infrastruktur (MinIO) muss im Compose-Profil "storage" laufen.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },

  // ====================== Familien-Freigaben ======================
  {
    key: 'FAMILY_SHARING_ENABLED',
    envVar: 'FAMILY_SHARING_ENABLED',
    category: 'runtime',
    type: 'boolean',
    group: 'Familien-Freigaben',
    description:
      'Schaltet die Familien-Freigaben (Einladungen und Haushaltsmitgliedschaften anderer ' +
      'Konten) ein oder aus. Aenderungen wirken sofort, ohne Neustart. Bei Deaktivierung ' +
      'liefern die Freigabe-Endpunkte 403 und der Navigationspunkt wird ausgeblendet.',
    defaultValue: true,
    connectivityTestable: false,
    permission: 'ADMIN',
  },

  // ====================== Connectivity (SSRF relaxation) ======================
  // BugFix-06: explicit opt-in – the strict SSRF protection (public http(s)
  // endpoints only) stays the secure default. Only when an end user operates
  // Paperless-ngx, Ollama or an OIDC provider in the LAN does he consciously
  // enable the relaxation; the cloud metadata address 169.254.169.254
  // remains blocked even then.
  {
    key: 'CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS',
    envVar: 'CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS',
    category: 'runtime',
    type: 'boolean',
    group: 'Connectivity',
    description:
      'Erlaubt Connectivity-Tests und AI-/OIDC-Aufrufe gegen lokale/private Endpunkte ' +
      '(RFC-1918, Loopback, lokale Hostnamen) – z. B. Paperless-ngx im LAN oder Ollama ' +
      'unter localhost. Standard: aus (= strikter SSRF-Schutz). Die Cloud-Metadata-Adresse ' +
      '169.254.169.254 bleibt auch bei aktivierter Option gesperrt. ' +
      'Hinweis: OIDC-Discovery liest das Flag nur beim Boot – fuer einen OIDC-Provider ' +
      'im LAN ist danach ein Neustart erforderlich.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'CONNECTIVITY_ALLOW_SELF_SIGNED',
    envVar: 'CONNECTIVITY_ALLOW_SELF_SIGNED',
    category: 'runtime',
    type: 'boolean',
    group: 'Connectivity',
    description:
      'Duldet bei HTTPS-Endpunkten selbst signierte/ungenuegende TLS-Zertifikate ' +
      '(nur fuer Connectivity-Tests und AI-/OIDC-Aufrufe, nicht global). Standard: aus.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },

  // ====================== Bootstrap / Infrastructure (env/compose only) ======================
  {
    key: 'NODE_ENV',
    envVar: 'NODE_ENV',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description: 'Laufzeitumgebung (development, test, production). Nur Environment/Compose.',
    defaultValue: 'development',
    allowedValues: ['development', 'test', 'production'],
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'APP_PORT',
    envVar: 'APP_PORT',
    category: 'bootstrap',
    type: 'number',
    group: 'Infrastruktur',
    description: 'Interner Port des API-Dienstes. Nur Environment/Compose.',
    defaultValue: 3001,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'WEB_PORT',
    envVar: 'WEB_PORT',
    category: 'bootstrap',
    type: 'number',
    group: 'Infrastruktur',
    description: 'Interner Port des Web-Dienstes. Nur Environment/Compose.',
    defaultValue: 3000,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'CORS_ORIGINS',
    envVar: 'CORS_ORIGINS',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description:
      'Erlaubte Browser-Origins fuer CORS (Komma-separiert). Nur Environment/Compose.',
    defaultValue: 'http://localhost:3000',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'TRUST_PROXY',
    envVar: 'TRUST_PROXY',
    category: 'bootstrap',
    type: 'boolean',
    group: 'Infrastruktur',
    description:
      'Nur hinter einem vertrauenswuerdigen Reverse-Proxy aktivieren. Nur Environment/Compose.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'COOKIE_SECURE',
    envVar: 'COOKIE_SECURE',
    category: 'bootstrap',
    type: 'boolean',
    group: 'Infrastruktur',
    description:
      'Secure-Flag des Session-Cookies. Leer (Default): pro Request "auto" – Secure nur ueber ' +
      'HTTPS (erfordert TRUST_PROXY=true hinter einem Reverse-Proxy); damit funktioniert ein ' +
      'Deployment sowohl ueber direkten IP/HTTP-Zugriff als auch ueber HTTPS-Proxy. ' +
      'Nur bei Bedarf explizit true/false setzen. Nur Environment/Compose.',
    defaultValue: true,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'DATABASE_URL',
    envVar: 'DATABASE_URL',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description: 'PostgreSQL-Verbindungsstring. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'REDIS_URL',
    envVar: 'REDIS_URL',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description: 'Redis-Verbindungsstring. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'DOCUMENTS_STORAGE_PATH',
    envVar: 'DOCUMENTS_STORAGE_PATH',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description: 'Dateisystempfad fuer lokal gespeicherte Dokumente. Nur Environment/Compose.',
    defaultValue: './uploads',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'LOCAL_AUTH_ENABLED',
    envVar: 'LOCAL_AUTH_ENABLED',
    category: 'bootstrap',
    type: 'boolean',
    group: 'Authentifizierung',
    description:
      'Schaltet die lokale Benutzername/Passwort-Anmeldung ein. Wird beim Boot ausgewertet ' +
      'und ist bewusst nicht ueber die UI aenderbar (Fail-Fast bei keiner Auth-Methode).',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'LOCAL_ADMIN_USERNAME',
    envVar: 'LOCAL_ADMIN_USERNAME',
    category: 'bootstrap',
    type: 'string',
    group: 'Authentifizierung',
    description: 'Initialer lokaler Administrator (nur Entwicklung/Test). Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'LOCAL_ADMIN_PASSWORD',
    envVar: 'LOCAL_ADMIN_PASSWORD',
    category: 'bootstrap',
    type: 'string',
    group: 'Authentifizierung',
    description: 'Initiales Passwort des lokalen Administrators. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_ENABLED',
    envVar: 'OIDC_ENABLED',
    category: 'restart',
    type: 'boolean',
    group: 'Authentifizierung',
    description:
      'Schaltet die OIDC-Anmeldung ein. Wird beim naechsten Start aktiv (die OIDC-Strategie ' +
      'initialisiert sich erst beim Boot); der Fail-Fast greift nur, wenn daneben keine lokale ' +
      'Anmeldung aktiv ist.',
    defaultValue: false,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_ISSUER_URL',
    envVar: 'OIDC_ISSUER_URL',
    category: 'restart',
    type: 'string',
    group: 'Authentifizierung',
    description:
      'OIDC-Issuer-URL (z. B. https://idp.example.com). Wird beim naechsten Start aktiv.',
    validationHint: 'Vollstaendige URL inklusive Schema, ohne nachgestellten Slash.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_CLIENT_ID',
    envVar: 'OIDC_CLIENT_ID',
    category: 'restart',
    type: 'string',
    group: 'Authentifizierung',
    description: 'OIDC-Client-ID. Wird beim naechsten Start aktiv.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_CLIENT_SECRET',
    envVar: 'OIDC_CLIENT_SECRET',
    category: 'secret',
    type: 'string',
    group: 'Authentifizierung',
    description:
      'OIDC-Client-Secret. Wird verschluesselt gespeichert, niemals im Klartext angezeigt ' +
      'oder protokolliert. Wird beim naechsten Start aktiv.',
    bootActivation: true,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_CALLBACK_URL',
    envVar: 'OIDC_CALLBACK_URL',
    category: 'restart',
    type: 'string',
    group: 'Authentifizierung',
    description:
      'OIDC-Callback-URL (z. B. https://app.example.com/auth/callback). Wird beim naechsten ' +
      'Start aktiv.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'SETTINGS_ENCRYPTION_KEY',
    envVar: 'SETTINGS_ENCRYPTION_KEY',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description:
      'Root-Secret zur Verschluesselung aller gespeicherten Einstellungen. ' +
      'Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'SESSION_SECRET',
    envVar: 'SESSION_SECRET',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description: 'Session-Geheimnis (express-session). Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'S3_ENDPOINT',
    envVar: 'S3_ENDPOINT',
    category: 'bootstrap',
    type: 'string',
    group: 'Speicher',
    description: 'S3/MinIO-Endpunkt. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'S3_BUCKET',
    envVar: 'S3_BUCKET',
    category: 'bootstrap',
    type: 'string',
    group: 'Speicher',
    description: 'S3-Bucket-Name. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'S3_ACCESS_KEY',
    envVar: 'S3_ACCESS_KEY',
    category: 'bootstrap',
    type: 'string',
    group: 'Speicher',
    description: 'S3-Zugriffsschluessel. Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'S3_SECRET_KEY',
    envVar: 'S3_SECRET_KEY',
    category: 'bootstrap',
    type: 'string',
    group: 'Speicher',
    description: 'S3-Geheimschluessel. Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'MINIO_ROOT_USER',
    envVar: 'MINIO_ROOT_USER',
    category: 'bootstrap',
    type: 'string',
    group: 'Speicher',
    description: 'MinIO-Root-Benutzer. Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'MINIO_ROOT_PASSWORD',
    envVar: 'MINIO_ROOT_PASSWORD',
    category: 'bootstrap',
    type: 'string',
    group: 'Speicher',
    description: 'MinIO-Root-Passwort. Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'NEXT_PUBLIC_API_BASE_URL',
    envVar: 'NEXT_PUBLIC_API_BASE_URL',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description:
      'Oeffentliche API-Basis-URL fuer den Browser. Leer (Default): der Browser leitet die URL ' +
      'automatisch aus der geladenen Seite ab (BugFix-14): direkter IP/HTTP-Zugriff -> ' +
      'http://<host>:<API-Port>, HTTPS via Reverse-Proxy -> https://<host>/api. Nur bei ' +
      'Proxy-URLs ausserhalb dieses Schemas explizit setzen. Nur Environment/Compose.',
    defaultValue: '',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'NEXT_ALLOWED_DEV_ORIGINS',
    envVar: 'NEXT_ALLOWED_DEV_ORIGINS',
    category: 'bootstrap',
    type: 'string',
    group: 'Infrastruktur',
    description: 'Next.js-Dev-Server: erlaubte Origins fuer HMR/Dev-Requests. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },

  // ====================== Worker Health ======================
  {
    key: 'WORKER_HEALTH_PORT',
    envVar: 'WORKER_HEALTH_PORT',
    category: 'bootstrap',
    type: 'number',
    group: 'Worker Health',
    description:
      'Interner Port des minimalen Worker-Liveness-Servers (GET /health). ' +
      'Nur Environment/Compose, wird nicht nach aussen publiziert.',
    defaultValue: 3100,
    min: 1024,
    max: 65535,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'WORKER_HEARTBEAT_INTERVAL_MS',
    envVar: 'WORKER_HEARTBEAT_INTERVAL_MS',
    category: 'bootstrap',
    type: 'number',
    group: 'Worker Health',
    description:
      'Intervall in Millisekunden, in dem der Worker seinen Heartbeat in ' +
      'PostgreSQL schreibt (Grundlage fuer worker up/down in GET /ready). ' +
      'Nur Environment/Compose.',
    defaultValue: 15_000,
    min: 1_000,
    max: 3_600_000,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'WORKER_HEARTBEAT_TIMEOUT_MS',
    envVar: 'WORKER_HEARTBEAT_TIMEOUT_MS',
    category: 'bootstrap',
    type: 'number',
    group: 'Worker Health',
    description:
      'Zeitfenster in Millisekunden, nach dem ein Heartbeat als veraltet gilt ' +
      '(Worker wird in GET /ready als "down" ausgewiesen). Nur Environment/Compose.',
    defaultValue: 45_000,
    min: 1_000,
    max: 3_600_000,
    connectivityTestable: false,
    permission: 'ADMIN',
  },
] as const;

const CATALOG_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS_CATALOG.map((definition) => [definition.key, definition]),
);

/** Returns the catalog definition of a key or undefined. */
export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** All keys that can be set via the admin UI (not bootstrap). */
export function getUiConfigurableKeys(): readonly string[] {
  return SETTINGS_CATALOG.filter((definition) => definition.category !== 'bootstrap').map(
    (definition) => definition.key,
  );
}

/** All keys that only become active after a restart. */
export function getRestartRequiredKeys(): readonly string[] {
  return SETTINGS_CATALOG.filter((definition) => definition.category === 'restart').map(
    (definition) => definition.key,
  );
}

/**
 * All keys that must be preloaded into `process.env` during boot:
 * restart category (active after restart) plus secrets with
 * `bootActivation` (construction-time consumers, e.g. OIDC_*).
 */
export function getBootPreloadKeys(): readonly string[] {
  return SETTINGS_CATALOG.filter(
    (definition) =>
      definition.category === 'restart' ||
      (definition.category === 'secret' && definition.bootActivation === true),
  ).map((definition) => definition.key);
}

/** A catalog key is considered a secret. */
export function isSecretKey(key: string): boolean {
  return getSettingDefinition(key)?.category === 'secret';
}
