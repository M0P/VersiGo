import { z } from 'zod';

/**
 * Central, typed configuration schema for API and worker.
 * Every environment variable is validated explicitly; no implicit
 * defaults for security-relevant values.
 */

/**
 * z.coerce.boolean() converts ANY non-empty string (including "false")
 * to true, because it uses Boolean(str) internally. For environment
 * variables a strict parser is therefore required that only accepts
 * "true"/"false" (case-insensitive) and treats everything else as a
 * validation error instead of silently falling back to false.
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
      message: `Invalid boolean value "${val}", expected "true" or "false"`,
    });
    return z.NEVER;
  });

/**
 * Like `booleanFromEnv`, but treats an empty string as "unset".
 * Docker Compose passes variables without a set default into the
 * container as empty strings; these are not treated as an explicit
 * (invalid) value here, but fall back to the default.
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
      message: `Invalid boolean value "${val}", expected "true" or "false"`,
    });
    return z.NEVER;
  });

/**
 * Optional env string that treats empty values like unset variables
 * (Docker Compose passes variables without a set value into the
 * container as ""). `.optional()` must sit INSIDE the preprocess step
 * so that the result "undefined" (empty string) passes validation.
 */
const optionalEnvString = (schema: z.ZodString) =>
  z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    schema.optional(),
  );

export const appConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // BugFix-11 (R7): runtime application version (e.g. "1.0.0-beta.1"),
    // injected via APP_VERSION in Compose. Public, harmless value exposed on
    // the health/readiness endpoints; empty values are treated as unset.
    APP_VERSION: optionalEnvString(z.string().min(1)).optional(),

    APP_PORT: z.coerce.number().int().positive().default(3001),
    WEB_PORT: z.coerce.number().int().positive().default(3000),

    // AP-19: worker liveness server + heartbeat. WORKER_HEALTH_PORT is used
    // only inside the container network (Compose healthcheck), never exposed
    // publicly. WORKER_HEARTBEAT_TIMEOUT_MS determines when the API reports
    // the worker as 'down' in /ready (not readiness-relevant for the API
    // itself, only status information).
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3100),
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
    WORKER_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

    // AP-16: allowed browser origins for CORS (comma-separated list).
    // The web app (default: http://localhost:3000) calls the API cross-origin
    // with credentials:'include'; without enableCors the browser blocks
    // reading the responses (preflight/AC-AO headers). Only explicitly
    // listed origins are accepted. An empty value falls back to the default.
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

    // AP-16/ADR-007: Express "trust proxy". Controls whether the app
    // accepts the X-Forwarded-* headers of a reverse proxy for req.ip.
    // Without this setting, every request behind a proxy falls back to
    // the same proxy IP (rate limits on req.ip would lock out all clients
    // globally). Default is false (direct connection); only set to true
    // behind a trusted reverse proxy.
    TRUST_PROXY: optionalBooleanFromEnv.optional(),

    // AP-20: secure flag of the session cookie. Default: true in production,
    // false otherwise (as before, config.isProduction). Express-session sets
    // no cookie at all over plain HTTP when secure:true (documented behavior);
    // deployments behind a TLS-terminating reverse proxy (internal HTTP
    // connection) or controlled internal installations without TLS can set
    // the flag explicitly. In all other cases keep the default.
    COOKIE_SECURE: optionalBooleanFromEnv.optional(),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    STORAGE_ENABLED: booleanFromEnv.default(false),

    DOCUMENTS_STORAGE_PATH: z.string().min(1).default('./uploads'),

    LOCAL_AUTH_ENABLED: optionalBooleanFromEnv.optional(),
    LOCAL_AUTH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOCAL_AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000), // 15 minutes

    // Initial local administrator (only for local development/test).
    // AP-16/ADR-007: The login identifier is the username (normalized
    // during bootstrap: lowercase + trim), not an email. Validation matches
    // the application's USERNAME_REGEX (3-32 characters, [a-z0-9._-],
    // starting with a letter/digit); uppercase letters are normalized
    // before the account is created.
    LOCAL_ADMIN_USERNAME: optionalEnvString(
      z
        .string()
        .regex(
          /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/,
          'LOCAL_ADMIN_USERNAME: 3-32 characters from [a-z0-9._-], starting with a letter or digit',
        ),
    ),
    LOCAL_ADMIN_PASSWORD: optionalEnvString(
      z.string().min(1, 'LOCAL_ADMIN_PASSWORD must not be empty'),
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

    // BugFix-05: family sharing (household sharing) is enabled by default
    // (existing behavior); admins can disable it in the feature management
    // (default true, therefore no mandatory env default in .env.example).
    // Note: `booleanFromEnv` rejects empty strings (Docker Compose sets
    // unset variables as ""). The variable must therefore NOT be listed
    // empty in Compose/.env — use optionalBooleanFromEnv for later additions.
    FAMILY_SHARING_ENABLED: booleanFromEnv.default(true),

    SETTINGS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'SETTINGS_ENCRYPTION_KEY must be a 32-byte hex string (64 characters)'),

    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be at least 32 characters long'),
  })
  .transform((cfg) => ({
    ...cfg,
    // OIDC is only active when explicitly enabled.
    OIDC_ENABLED: cfg.OIDC_ENABLED ?? false,
    // Local authentication is the default for local development and
    // test environments. In production it stays disabled until set
    // explicitly; then the fail-fast in the IdentityModule kicks in
    // if no authentication method is configured.
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
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return result.data;
}
