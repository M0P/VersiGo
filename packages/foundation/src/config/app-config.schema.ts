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

export const appConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_PORT: z.coerce.number().int().positive().default(3001),
  WEB_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich'),

  REDIS_URL: z.string().min(1, 'REDIS_URL ist erforderlich'),

  STORAGE_ENABLED: booleanFromEnv.default(false),

  DOCUMENTS_STORAGE_PATH: z.string().min(1).default('./uploads'),

  OIDC_ENABLED: booleanFromEnv.default(false),
  OIDC_ISSUER_URL: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),

  AI_ENABLED: booleanFromEnv.default(false),

  PAPERLESS_ENABLED: booleanFromEnv.default(false),
  PAPERLESS_URL: z.string().optional(),
  PAPERLESS_API_TOKEN: z.string().optional(),

  SETTINGS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SETTINGS_ENCRYPTION_KEY muss ein 32-Byte-Hex-String (64 Zeichen) sein'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET muss mindestens 32 Zeichen lang sein'),

  OIDC_CALLBACK_URL: z.string().optional(),
});

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
