import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AesGcmEncryptionAdapter } from '../encryption/aes-gcm-encryption.adapter';
import { AppConfigService } from './app-config.service';
import { getBootPreloadKeys, getSettingDefinition } from './settings-catalog';
import { validateSettingValue } from './settings-validation';

/**
 * Boot preload for construction-time settings (AP-17/BugFix-05).
 *
 * Category-4 values ("not dynamically applicable") are stored via the
 * admin UI in the database and only become active at the next process
 * start. This function reads them from the database BEFORE the Nest DI
 * initialization and writes them into the environment so that
 * construction-time consumers (e.g. rate limiter, OIDC strategy) see
 * the DB values.
 *
 * Guarantees:
 * - Fail-soft: if the database is unreachable at startup or the env
 *   configuration is missing, the preload is skipped and the app starts
 *   with the plain `.env` configuration (log warning).
 * - Time-bound: the whole preload has an upper limit (default 15 s).
 *   If the DB access hangs (e.g. connection timeout, saturated pool),
 *   the preload gives up after the limit and the app still starts — an
 *   app start must never hang on the preload.
 * - Only catalogued `restart` keys and secrets with `bootActivation`
 *   (e.g. OIDC_CLIENT_SECRET) are transferred; no bootstrap values.
 * - Called from API and worker main.ts before NestFactory.
 */
const PRELOAD_TIMED_OUT = 'PRELOAD_TIMED_OUT';

export async function preloadRestartSettingsIntoEnv(
  env: Record<string, string | undefined> = process.env,
  timeoutMs = 15_000,
): Promise<number> {
  const restartKeys = getBootPreloadKeys();
  if (restartKeys.length === 0) return 0;

  const databaseUrl = env.DATABASE_URL;
  const encryptionKeyHex = env.SETTINGS_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKeyHex) {
    Logger.warn(
      'Settings preload skipped: DATABASE_URL or SETTINGS_ENCRYPTION_KEY is missing.',
      'SettingsPreload',
    );
    return 0;
  }

  const work = async (): Promise<number> => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    try {
      const rows = await prisma.globalIntegrationSetting.findMany({
        where: { key: { in: [...restartKeys] } },
        select: { key: true, valueEncrypted: true, valuePlain: true },
      });
      if (rows.length === 0) return 0;

      const encryption = new AesGcmEncryptionAdapter(new AppConfigService(env));
      let applied = 0;
      let skipped = 0;
      for (const row of rows) {
        const definition = getSettingDefinition(row.key);
        if (!definition) {
          // Unknown key (e.g. from legacy entries): never adopt into the
          // environment — the allowlist applies without exception.
          Logger.warn(
            `Settings preload: key '${row.key}' is not in the catalog (allowlist) – skipped.`,
            'SettingsPreload',
          );
          skipped += 1;
          continue;
        }

        const rawValue = row.valueEncrypted
          ? await encryption.decrypt(row.valueEncrypted)
          : (row.valuePlain ?? null);
        if (rawValue === null) continue;

        // Strictly typed validation against the catalog definition: an
        // invalid DB value is NEVER written into the environment (otherwise
        // the AppConfigService could fail hard during boot — fail-soft
        // guarantee).
        const validated = validateSettingValue(definition, rawValue);
        if (!validated.ok) {
          Logger.warn(
            `Settings preload: DB value for '${row.key}' invalid (${validated.error}) – ` +
              'not applied, .env/default stays active.',
            'SettingsPreload',
          );
          skipped += 1;
          continue;
        }

        // Write the canonical form so that env consumers see exactly the
        // value that validation/resolution also use.
        env[row.key] = validated.canonical;
        applied += 1;
      }
      if (applied > 0 || skipped > 0) {
        Logger.log(
          `Settings preload: ${applied} restart setting(s) applied from the database` +
            (skipped > 0 ? `, ${skipped} invalid skipped` : '') +
            '.',
          'SettingsPreload',
        );
      }
      return applied;
    } finally {
      // Disconnect must not block the startup either.
      await prisma.$disconnect().catch(() => undefined);
    }
  };

  const timeout = new Promise<number | typeof PRELOAD_TIMED_OUT>((resolve) => {
    const timer = setTimeout(() => resolve(PRELOAD_TIMED_OUT), timeoutMs);
    // The timer must not artificially delay the process exit.
    timer.unref?.();
  });

  try {
    const result = await Promise.race([work(), timeout]);
    if (result === PRELOAD_TIMED_OUT) {
      Logger.warn(
        `Settings preload skipped (timeout after ${timeoutMs} ms): ` +
          'DB access hangs – the app starts with the .env configuration.',
        'SettingsPreload',
      );
      return 0;
    }
    return result;
  } catch (error) {
    Logger.warn(
      `Settings preload skipped (database unreachable?): ${
        error instanceof Error ? error.message : 'unknown error'
      } – the app starts with the .env configuration.`,
      'SettingsPreload',
    );
    return 0;
  }
}
