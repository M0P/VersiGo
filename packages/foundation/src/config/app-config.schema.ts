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

    DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich'),

    REDIS_URL: z.string().min(1, 'REDIS_URL ist erforderlich'),

    STORAGE_ENABLED: booleanFromEnv.default(false),

    DOCUMENTS_STORAGE_PATH: z.string().min(1).default('./uploads'),

    LOCAL_AUTH_ENABLED: optionalBooleanFromEnv.optional(),
    LOCAL_AUTH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOCAL_AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000), // 15 minutes

    // Initialer lokaler Administrator (nur fuer lokale Entwicklung/Test)
    LOCAL_ADMIN_EMAIL: optionalEnvString(
      z.string().email('LOCAL_ADMIN_EMAIL muss eine gueltige E-Mail-Adresse sein'),
    ),
    LOCAL_ADMIN_PASSWORD: optionalEnvString(
      z.string().min(1, 'LOCAL_ADMIN_PASSWORD darf nicht leer sein'),
    ),
    LOCAL_ADMIN_FIRST_NAME: optionalEnvString(z.string().min(1)),
    LOCAL_ADMIN_LAST_NAME: optionalEnvString(z.string().min(1)),

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
