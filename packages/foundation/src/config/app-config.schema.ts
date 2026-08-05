import { z } from 'zod';

/**
 * Zentrales, typisiertes Konfigurationsschema fuer API und Worker.
 * Jede Umgebungsvariable wird explizit validiert; keine impliziten
 * Defaults fuer sicherheitsrelevante Werte.
 */

/**
 * z.coerce.boolean() wandelt JEDEN nicht-leeren String (auch "false")
 * zu true, da intern Boolean(str) verwendet wird. Fuer Env-Variablen
 * ist daher ein strikter Parser notwendig, der nur "true"/"false"
 * (case-insensitive) akzeptiert und alles andere als Validierungsfehler
 * behandelt, statt stillschweigend auf false zu fallen.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((val, ctx) => {
    if (typeof val === 'boolean') return val;
    const normalized = val.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Ungueltiger Boolean-Wert "${val}", erwartet wird "true" oder "false"`,
    });
    return z.NEVER;
  });

/**
 * Wie `booleanFromEnv`, behandelt aber einen leeren String als
 * "nicht gesetzt". Docker Compose reicht Variablen ohne gesetzten
 * Default-Wert als leeren String in den Container durch; diese werden
 * hier nicht als explizite (ungueltige) Angabe gewertet, sondern fallen
 * auf den Default zurueck.
 */
const optionalBooleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((val, ctx) => {
    if (typeof val === 'boolean') return val;
    const normalized = val.trim().toLowerCase();
    if (normalized === '') return undefined;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Ungueltiger Boolean-Wert "${val}", erwartet wird "true" oder "false"`,
    });
    return z.NEVER;
  });

/**
 * Optionaler Env-String, der leere Werte wie nicht gesetzte Variablen
 * behandelt (Docker Compose reicht Variablen ohne gesetzten Wert als
 * "" in den Container durch). `.optional()` muss INNERHALB des
 * Preprocess-Schritts liegen, damit das Ergebnis "undefined" (leerer
 * String) die Validierung passiert.
 */
const optionalEnvString = (schema: z.ZodString) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    schema.optional(),
  );

export const appConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    APP_PORT: z.coerce.number().int().positive().default(3001),
    WEB_PORT: z.coerce.number().int().positive().default(3000),

    // AP-19: Worker-Liveness-Server + Heartbeat. WORKER_HEALTH_PORT wird nur
    // innerhalb des Container-Netzwerks genutzt (Compose-Healthcheck), nie
    // nach aussen publiziert. WORKER_HEARTBEAT_TIMEOUT_MS bestimmt, ab wann
    // die API den Worker in /ready als 'down' meldet (nicht als bereit-
    // heitsrelevant fuer die API selbst, nur als Status-Information).
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3100),
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
    WORKER_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

    // AP-16: Erlaubte Browser-Origins fuer CORS (Komma-separierte Liste).
    // Die Web-App (Standard: http://localhost:3000) ruft die API cross-origin
    // mit credentials:'include' auf; ohne enableCors blockiert der Browser
    // das Lesen der Antworten (Preflight/AC-AO-Header). Nur explizit gelistete
    // Origins werden akzeptiert. Ein leerer Wert faellt auf den Default zurueck.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((val) =>
        val
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      )
      .transform((origins) => (origins.length > 0 ? origins : ['http://localhost:3000'])),

    // AP-16/ADR-007: Express "trust proxy". Steuert, ob die App die
    // X-Forwarded-*-Header eines Reverse-Proxys fuer req.ip akzeptiert.
    // Ohne diese Einstellung faellt hinter einem Proxy jede Anfrage auf
    // dieselbe Proxy-IP zurueck (Rate-Limits auf req.ip wuerden alle
    // Clients global sperren). Standard ist false (direkte Verbindung);
    // nur hinter einem vertrauenswuerdigen Reverse-Proxy auf true setzen.
    TRUST_PROXY: optionalBooleanFromEnv.optional(),

    // AP-20: Secure-Flag des Session-Cookies. Default: true in Produktion,
    // false sonst (wie bisher config.isProduction). Express-Session setzt
    // bei secure:true ueber reines HTTP gar kein Cookie (dokumentiertes
    // Verhalten); Deployments hinter einem TLS-terminierenden Reverse-Proxy
    // (interne HTTP-Verbindung) oder kontrollierte interne Installationen
    // ohne TLS koennen das Flag daher explizit setzen. In allen anderen
    // Faellen den Standard beibehalten.
    COOKIE_SECURE: optionalBooleanFromEnv.optional(),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich'),

    REDIS_URL: z.string().min(1, 'REDIS_URL ist erforderlich'),

    STORAGE_ENABLED: booleanFromEnv.default(false),

    DOCUMENTS_STORAGE_PATH: z.string().min(1).default('./uploads'),

    LOCAL_AUTH_ENABLED: optionalBooleanFromEnv.optional(),
    LOCAL_AUTH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOCAL_AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000), // 15 minutes

    // Initialer lokaler Administrator (nur fuer lokale Entwicklung/Test).
    // AP-16/ADR-007: Der Login-Identifier ist der Benutzername (normalisiert
    // im Bootstrap: lowercase + trim), keine E-Mail. Validierung entspricht
    // der USERNAME_REGEX der Anwendung (3-32 Zeichen, [a-z0-9._-], Start mit
    // Buchstabe/Ziffer); Grossbuchstaben werden vor Anlage normalisiert.
    LOCAL_ADMIN_USERNAME: optionalEnvString(
      z
        .string()
        .regex(
          /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/,
          'LOCAL_ADMIN_USERNAME: 3-32 Zeichen aus [a-z0-9._-], Start mit Buchstabe oder Ziffer',
        ),
    ),
    LOCAL_ADMIN_PASSWORD: optionalEnvString(
      z.string().min(1, 'LOCAL_ADMIN_PASSWORD darf nicht leer sein'),
    ),

    OIDC_ENABLED: optionalBooleanFromEnv.optional(),
    OIDC_ISSUER_URL: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),
    OIDC_CALLBACK_URL: z.string().optional(),

    AI_ENABLED: booleanFromEnv.default(false),
    AI_PROVIDER: z.enum(['ollama', 'openai-compat']).default('ollama'),
    AI_OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
    AI_OLLAMA_MODEL: z.string().default('llama3'),
    AI_OPENAI_COMPAT_BASE_URL: z.string().optional(),
    AI_OPENAI_COMPAT_API_KEY: z.string().optional(),
    AI_OPENAI_COMPAT_MODEL: z.string().default('gpt-4o-mini'),
    AI_EXTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    PAPERLESS_ENABLED: booleanFromEnv.default(false),
    PAPERLESS_URL: z.string().optional(),
    PAPERLESS_API_TOKEN: z.string().optional(),

    // BugFix-05: Familien-Freigaben (Household-Sharing) sind standardmaessig
    // aktiviert (Bestandsverhalten); Admins koennen sie in der Feature-
    // Verwaltung deaktivieren (Default true, daher kein zwingender
    // Umgebungs-Default in .env.example noetig).
    // Hinweis: `booleanFromEnv` lehnt leere Strings ab (Docker Compose setzt
    // ungesetzte Variablen als ""). Die Variable darf daher NICHT leer in
    // Compose/.env gefuehrt werden – bei spaeterer Erweiterung optionalBooleanFromEnv.
    FAMILY_SHARING_ENABLED: booleanFromEnv.default(true),

    SETTINGS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'SETTINGS_ENCRYPTION_KEY muss ein 32-Byte-Hex-String (64 Zeichen) sein'),

    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET muss mindestens 32 Zeichen lang sein'),
  })
  .transform((cfg) => ({
    ...cfg,
    // OIDC ist nur bei expliziter Aktivierung aktiv.
    OIDC_ENABLED: cfg.OIDC_ENABLED ?? false,
    // Lokale Authentifizierung ist der Standard fuer lokale Entwicklungs-
    // und Testumgebungen. In Produktion bleibt sie deaktiviert, bis sie
    // explizit gesetzt wird; dann greift der Fail-Fast im IdentityModule,
    // falls keine Authentifizierungsmethode konfiguriert ist.
    LOCAL_AUTH_ENABLED: cfg.LOCAL_AUTH_ENABLED ?? cfg.NODE_ENV !== 'production',
    TRUST_PROXY: cfg.TRUST_PROXY ?? false,
    COOKIE_SECURE: cfg.COOKIE_SECURE ?? cfg.NODE_ENV === 'production',
  }));

export type AppConfig = z.infer<typeof appConfigSchema>;

export function parseAppConfig(env: Record<string, string | undefined>): AppConfig {
  const result = appConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Ungueltige Konfiguration: ${issues}`);
  }
  return result.data;
}
