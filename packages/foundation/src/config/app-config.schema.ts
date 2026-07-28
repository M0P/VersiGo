import { z } from 'zod';

const booleanFromEnv = z
.union([z.boolean(), z.string()])
.transform((val) => {
  if (typeof val === 'boolean') return val;
  return val.toLowerCase() === 'true';
});

export const appConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

                                        APP_PORT: z.coerce.number().int().positive().default(3001),
                                        WEB_PORT: z.coerce.number().int().positive().default(3000),

                                        DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich'),

                                        REDIS_URL: z.string().min(1, 'REDIS_URL ist erforderlich'),

                                        STORAGE_ENABLED: booleanFromEnv.default(false),

                                        OIDC_ENABLED: booleanFromEnv.default(false),
                                        OIDC_ISSUER_URL: z.string().optional(),
                                        OIDC_CLIENT_ID: z.string().optional(),
                                        OIDC_CLIENT_SECRET: z.string().optional(),

                                        AI_ENABLED: booleanFromEnv.default(false),

                                        PAPERLESS_ENABLED: booleanFromEnv.default(false),

                                        SETTINGS_ENCRYPTION_KEY: z
                                        .string()
                                        .regex(/^[0-9a-fA-F]{64}$/, 'SETTINGS_ENCRYPTION_KEY muss ein 32-Byte-Hex-String (64 Zeichen) sein'),
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
