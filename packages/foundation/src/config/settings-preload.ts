import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AesGcmEncryptionAdapter } from '../encryption/aes-gcm-encryption.adapter';
import { AppConfigService } from './app-config.service';
import { getBootPreloadKeys, getSettingDefinition } from './settings-catalog';
import { validateSettingValue } from './settings-validation';

/**
 * Boot-Preload fuer Konstruktionszeit-Settings (AP-17/BugFix-05).
 *
 * Kategorie-4-Werte ("nicht dynamisch anwendbar") werden ueber die
 * Admin-UI in der Datenbank gespeichert und erst beim naechsten
 * Prozessstart aktiv. Diese Funktion liest sie VOR der Nest-DI-
 * Initialisierung aus der Datenbank und schreibt sie in die
 * Umgebungsvariable, damit Konstruktionszeit-Konsumenten (z. B.
 * Rate-Limiter, OIDC-Strategie) die DB-Werte sehen.
 *
 * Garantien:
 * - Fail-soft: Ist die Datenbank beim Start nicht erreichbar oder
 *   fehlt die Env-Konfiguration, wird der Preload uebersprungen und
 *   die App startet mit der reinen `.env`-Konfiguration (Log-Warnung).
 * - Zeitgebunden: Der gesamte Preload ist mit einer Obergrenze
 *   (Default 15 s) versehen. Haengt der DB-Zugriff (z. B. Verbindungs-
 *   Timeout, ausgelasteter Pool), gibt der Preload nach Ablauf auf und
 *   die App startet trotzdem – ein App-Start darf nie am Preload
 *   haengen bleiben.
 * - Es werden nur katalogisierte `restart`-Schluessel sowie Secrets
 *   mit `bootActivation` (z. B. OIDC_CLIENT_SECRET) uebertragen;
 *   keine bootstrap-Werte.
 * - Wird von API- und Worker-main.ts vor NestFactory aufgerufen.
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
      'Settings-Preload uebersprungen: DATABASE_URL oder SETTINGS_ENCRYPTION_KEY fehlt.',
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
          // Unbekannter Schluessel (z. B. aus Legacy-Eintraegen): nie in die
          // Umgebung uebernehmen – die Allowlist gilt ausnahmslos.
          Logger.warn(
            `Settings-Preload: Schluessel '${row.key}' ist nicht im Katalog (Allowlist) – uebersprungen.`,
            'SettingsPreload',
          );
          skipped += 1;
          continue;
        }

        const rawValue = row.valueEncrypted
          ? await encryption.decrypt(row.valueEncrypted)
          : (row.valuePlain ?? null);
        if (rawValue === null) continue;

        // Typstrikte Validierung gegen die Katalog-Definition: Ein ungueltiger
        // DB-Wert wird NIE in die Umgebung geschrieben (sonst koennte der
        // AppConfigService beim Boot hart scheitern – Fail-soft-Garantie).
        const validated = validateSettingValue(definition, rawValue);
        if (!validated.ok) {
          Logger.warn(
            `Settings-Preload: DB-Wert fuer '${row.key}' ungueltig (${validated.error}) – ` +
              'nicht uebernommen, .env/Default bleibt aktiv.',
            'SettingsPreload',
          );
          skipped += 1;
          continue;
        }

        // Kanonische Form schreiben, damit Env-Konsumenten genau den Wert
        // sehen, den auch die Validierung/Aufloesung verwenden.
        env[row.key] = validated.canonical;
        applied += 1;
      }
      if (applied > 0 || skipped > 0) {
        Logger.log(
          `Settings-Preload: ${applied} Neustart-Setting(s) aus der Datenbank uebernommen` +
            (skipped > 0 ? `, ${skipped} ungueltige/r uebersprungen` : '') +
            '.',
          'SettingsPreload',
        );
      }
      return applied;
    } finally {
      // Disconnect darf den Start ebenfalls nicht blockieren.
      await prisma.$disconnect().catch(() => undefined);
    }
  };

  const timeout = new Promise<number | typeof PRELOAD_TIMED_OUT>((resolve) => {
    const timer = setTimeout(() => resolve(PRELOAD_TIMED_OUT), timeoutMs);
    // Der Timer soll den Prozess-Exit nicht kuenstlich verzoegern.
    timer.unref?.();
  });

  try {
    const result = await Promise.race([work(), timeout]);
    if (result === PRELOAD_TIMED_OUT) {
      Logger.warn(
        `Settings-Preload uebersprungen (Zeitueberschreitung nach ${timeoutMs} ms): ` +
          'DB-Zugriff haengt – die App startet mit der .env-Konfiguration.',
        'SettingsPreload',
      );
      return 0;
    }
    return result;
  } catch (error) {
    Logger.warn(
      `Settings-Preload uebersprungen (Datenbank nicht erreichbar?): ${
        error instanceof Error ? error.message : 'unbekannter Fehler'
      } – die App startet mit der .env-Konfiguration.`,
      'SettingsPreload',
    );
    return 0;
  }
}
