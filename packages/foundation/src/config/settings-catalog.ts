/**
 * Versionierter Settings-Katalog (Allowlist) fuer die zentrale
 * Systemkonfiguration (AP-17).
 *
 * Der Katalog inventarisiert JEDE Konfigurationsvariable der Anwendung
 * (AppConfig-Schema, Compose, `.env.example`) und ordnet sie genau einer
 * Kategorie zu. Nur katalogisierte Schluessel duerfen ueber die Admin-UI
 * gesetzt werden; unbekannte oder freie `.env`-Namen werden strikt
 * abgewiesen ("Allowlist-basiert, kein JSON-Sammelfeld").
 *
 * Kategorien:
 * - `runtime`  : UI-konfigurierbar, wird an der Verwendungsstelle sofort
 *                wirksam (zentrale Aufloesung via SettingsResolverService).
 * - `restart`  : UI-konfigurierbar, wird erst beim naechsten Prozessstart
 *                aktiv (Boot-Preload in API/Worker); die UI zeigt
 *                "Neustart erforderlich" und stellt den Wert nie als
 *                bereits aktiv dar.
 * - `secret`   : UI-konfigurierbar, verschluesselt persistiert, nie im
 *                Klartext ausgegeben, geloggt oder in Audits gespeichert.
 * - `bootstrap`: Infrastrukturkritisch – nur Environment/Compose. Werte
 *                werden nie ueber die UI gespeichert, angezeigt oder
 *                ueberschrieben.
 */

export type SettingsCategory = 'runtime' | 'restart' | 'secret' | 'bootstrap';

export type SettingsValueType = 'boolean' | 'number' | 'string';

export type SettingsPermission = 'ADMIN';

export interface SettingDefinition {
  /** Eindeutiger Katalog-Schluessel (identisch mit dem Env-Variablennamen). */
  key: string;
  /** Env-Variablenname als Fallback-Quelle. */
  envVar: string;
  category: SettingsCategory;
  type: SettingsValueType;
  /** UI-Gruppe, unter der der Schluessel gruppiert wird. */
  group: string;
  /** Sichtbare, verstaendliche Beschreibung (deutsch, fuer Admin-UI + Doku). */
  description: string;
  /** Sicherer, dokumentierter Code-Default. Fehlt er, degradiert die Funktion. */
  defaultValue?: string | number | boolean;
  /** Fuer String-Werte: erlaubte Auswahl (z. B. Provider-Namen). */
  allowedValues?: readonly string[];
  /** Numerische Unter-/Obergrenzen. */
  min?: number;
  max?: number;
  /** Optionaler Validierungshinweis fuer die UI. */
  validationHint?: string;
  /** Ob eine sichere Connectivity-Pruefung existiert (nur fuer die jeweilige Integration). */
  connectivityTestable: boolean;
  /** Rechteanforderung (einheitlich: nur globale ADMINS). */
  permission: SettingsPermission;
}

export const SETTINGS_CATALOG_VERSION = 1;

/**
 * Vollstaendiger Konfigurationskatalog. Sortiert nach Gruppe, dann Key.
 * Wird im Test gegen die AppConfig-Schema-Keys und die Doku abgeglichen.
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

  // ====================== Bootstrap / Infrastruktur (nur Environment/Compose) ======================
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
    category: 'bootstrap',
    type: 'boolean',
    group: 'Authentifizierung',
    description:
      'Schaltet die OIDC-Anmeldung ein. Wird beim Boot ausgewertet und ist bewusst nicht ' +
      'ueber die UI aenderbar (Fail-Fast bei keiner Auth-Methode).',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_ISSUER_URL',
    envVar: 'OIDC_ISSUER_URL',
    category: 'bootstrap',
    type: 'string',
    group: 'Authentifizierung',
    description: 'OIDC-Issuer-URL. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_CLIENT_ID',
    envVar: 'OIDC_CLIENT_ID',
    category: 'bootstrap',
    type: 'string',
    group: 'Authentifizierung',
    description: 'OIDC-Client-ID. Nur Environment/Compose.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_CLIENT_SECRET',
    envVar: 'OIDC_CLIENT_SECRET',
    category: 'bootstrap',
    type: 'string',
    group: 'Authentifizierung',
    description: 'OIDC-Client-Secret. Nur Environment/Compose, niemals anzeigen.',
    connectivityTestable: false,
    permission: 'ADMIN',
  },
  {
    key: 'OIDC_CALLBACK_URL',
    envVar: 'OIDC_CALLBACK_URL',
    category: 'bootstrap',
    type: 'string',
    group: 'Authentifizierung',
    description: 'OIDC-Callback-URL. Nur Environment/Compose.',
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
    description: 'Oeffentliche API-Basis-URL fuer den Browser (Next.js Build-Zeit). Nur Environment/Compose.',
    defaultValue: 'http://localhost:3001',
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

/** Liefert die Katalog-Definition eines Schluessels oder undefined. */
export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** Alle Schluessel, die ueber die Admin-UI setzbar sind (nicht bootstrap). */
export function getUiConfigurableKeys(): readonly string[] {
  return SETTINGS_CATALOG.filter((definition) => definition.category !== 'bootstrap').map(
    (definition) => definition.key,
  );
}

/** Alle Schluessel, die erst nach einem Neustart aktiv werden. */
export function getRestartRequiredKeys(): readonly string[] {
  return SETTINGS_CATALOG.filter((definition) => definition.category === 'restart').map(
    (definition) => definition.key,
  );
}

/** Ein Katalog-Schluessel gilt als geheim (Secret). */
export function isSecretKey(key: string): boolean {
  return getSettingDefinition(key)?.category === 'secret';
}
