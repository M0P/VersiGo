import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database';
import { ENCRYPTION_PORT, type EncryptionPort } from '../encryption/encryption.port';
import { getSettingDefinition, type SettingDefinition } from './settings-catalog';
import { validateSettingValue } from './settings-validation';

/**
 * Central configuration resolution (AP-17).
 *
 * Deterministic priority chain for EVERY catalogued key:
 *   1. a valid, enabled, database-backed UI value wins,
 *   2. otherwise the validated `.env` value applies as fallback,
 *   3. otherwise only the safe, documented code default applies or the
 *      affected optional feature degrades.
 *
 * API and worker use exactly this resolution — features never read
 * `process.env` directly and therefore cannot bypass UI overrides.
 * Secrets are decrypted internally and only returned to authorized
 * feature consumers; the admin UI masks them by default.
 *
 * An invalid UI value never activates a broken effective state:
 * it is skipped, the previously effective configuration (ENV/default)
 * stays active and `uiValueInvalid` makes the error visible to admins.
 */

export type SettingSource = 'UI' | 'ENV' | 'DEFAULT';

export interface SettingResolution {
  key: string;
  /** Effective, validated value (undefined = unavailable -> degradation). */
  value: string | number | boolean | undefined;
  /** Source of the effective value. */
  source: SettingSource;
  /** Human-readable reason for the admin UI (German). */
  reason: string;
  /** A validated UI value is active. */
  uiValuePresent: boolean;
  /** UI value present but invalid (ignored; ENV/default active). */
  uiValueInvalid: boolean;
  /** Timestamp of the last UI change (if any). */
  uiUpdatedAt: Date | null;
  /**
   * Restart category only: validated UI value that only becomes active at
   * the next process start (boot preload). `value`/`source` describe the
   * actually active value until then (ENV/default) — the restart value is
   * never falsely presented as already active.
   */
  pendingRestartValue?: string | number | boolean;
}

@Injectable()
export class SettingsResolverService {
  private readonly logger = new Logger(SettingsResolverService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
    @Optional() private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  /**
   * Full resolution of a catalogued key.
   * Throws an error for unknown (non-catalogued) keys —
   * the allowlist applies without exception.
   */
  async resolve(key: string): Promise<SettingResolution> {
    const definition = getSettingDefinition(key);
    if (!definition) {
      throw new Error(`Unknown settings key '${key}' – not in the catalog (allowlist).`);
    }

    const stored = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    return this.resolveStored(definition, stored);
  }

  /**
   * Bundled resolution of multiple keys with a SINGLE database access
   * (avoids N+1 round trips, e.g. for the admin UI catalog view).
   * Throws like `resolve` for unknown keys.
   */
  async resolveMany(keys: string[]): Promise<Map<string, SettingResolution>> {
    const uniqueKeys = [...new Set(keys)];
    const storedRows = await this.db.globalIntegrationSetting.findMany({
      where: { key: { in: uniqueKeys } },
    });
    const storedByKey = new Map(storedRows.map((row) => [row.key, row]));

    const results = new Map<string, SettingResolution>();
    for (const key of uniqueKeys) {
      const definition = getSettingDefinition(key);
      if (!definition) {
        throw new Error(`Unknown settings key '${key}' – not in the catalog (allowlist).`);
      }
      results.set(key, await this.resolveStored(definition, storedByKey.get(key) ?? null));
    }
    return results;
  }

  /** Effective string value (e.g. URLs, models, providers). */
  async getEffectiveString(key: string): Promise<string | undefined> {
    const resolution = await this.resolve(key);
    return typeof resolution.value === 'string' ? resolution.value : undefined;
  }

  /** Effective boolean value (e.g. feature switches). */
  async getEffectiveBoolean(key: string): Promise<boolean | undefined> {
    const resolution = await this.resolve(key);
    return typeof resolution.value === 'boolean' ? resolution.value : undefined;
  }

  /** Effective numeric value (e.g. timeouts, limits). */
  async getEffectiveNumber(key: string): Promise<number | undefined> {
    const resolution = await this.resolve(key);
    return typeof resolution.value === 'number' ? resolution.value : undefined;
  }

  // --- Internal ---

  /**
   * Resolution against an already loaded DB row (or null). Shared
   * logic of `resolve` and `resolveMany`.
   */
  private async resolveStored(
    definition: SettingDefinition,
    stored: {
      valueEncrypted: string | null;
      valuePlain: string | null;
      updatedAt: Date;
    } | null,
  ): Promise<SettingResolution> {
    if (stored) {
      const rawValue = stored.valueEncrypted
        ? await this.encryption.decrypt(stored.valueEncrypted)
        : (stored.valuePlain ?? null);

      if (rawValue !== null && rawValue.trim() !== '') {
        const coerced = validateSettingValue(definition, rawValue);
        if (coerced.ok) {
          if (definition.category === 'restart') {
            // Restart category: the DB value only becomes active at the next
            // process start (boot preload). Until then the ENV/default value
            // stays effective; the new value is explicitly delivered as
            // "after restart" (pendingRestartValue) and never presented as
            // already active.
            const active = await this.resolveEnvOrDefault(definition);
            // If the DB value is already active (identical to .env/default —
            // e.g. because the preload wrote it into the environment after a
            // restart), there is nothing pending.
            const alreadyActive =
              active.value !== undefined && String(active.value) === String(coerced.value);
            return {
              ...active,
              uiValuePresent: true,
              uiValueInvalid: false,
              uiUpdatedAt: stored.updatedAt,
              pendingRestartValue: alreadyActive ? undefined : coerced.value,
              reason: alreadyActive
                ? `Wert aus Admin-UI (Datenbank) ist bereits aktiv – kein Neustart erforderlich`
                : `Wert aus Admin-UI (Datenbank) – aktiv nach Neustart; aktuell wirksam: ${active.reason.toLowerCase()}`,
            };
          }
          return {
            key: definition.key,
            value: coerced.value,
            source: 'UI',
            reason: `Wert aus Admin-UI (Datenbank) – wirksam`,
            uiValuePresent: true,
            uiValueInvalid: false,
            uiUpdatedAt: stored.updatedAt,
          };
        }
        // Invalid UI value: ignore, keep ENV/default active.
        this.logger.warn(
          `UI value for '${definition.key}' invalid (${coerced.error}) – ENV/default stays active.`,
        );
        const fallback = await this.resolveEnvOrDefault(definition);
        return {
          ...fallback,
          uiValuePresent: true,
          uiValueInvalid: true,
          uiUpdatedAt: stored.updatedAt,
        };
      }
      // Stored row without a usable value: treat as "unset".
      const fallback = await this.resolveEnvOrDefault(definition);
      return { ...fallback, uiValuePresent: false, uiValueInvalid: false, uiUpdatedAt: null };
    }

    const fallback = await this.resolveEnvOrDefault(definition);
    return { ...fallback, uiValuePresent: false, uiValueInvalid: false, uiUpdatedAt: null };
  }

  private async resolveEnvOrDefault(
    definition: SettingDefinition,
  ): Promise<
    Omit<
      SettingResolution,
      'uiValuePresent' | 'uiValueInvalid' | 'uiUpdatedAt' | 'pendingRestartValue'
    >
  > {
    const rawEnv = this.env[definition.envVar];
    const envPresent = rawEnv !== undefined && rawEnv.trim() !== '';

    if (envPresent) {
      const coerced = validateSettingValue(definition, rawEnv);
      if (coerced.ok) {
        return {
          key: definition.key,
          value: coerced.value,
          source: 'ENV',
          reason: `Fallback: Wert aus .env/Umgebung (${definition.envVar})`,
        };
      }
      // Invalid env value: degrade to the safe default.
      this.logger.warn(
        `Env value for '${definition.envVar}' invalid (${coerced.error}) – default is used.`,
      );
    }

    if (definition.defaultValue !== undefined) {
      return {
        key: definition.key,
        value: definition.defaultValue,
        source: 'DEFAULT',
        reason:
          envPresent && rawEnv !== undefined
            ? `Env-Wert ungueltig – sicherer Code-Default aktiv`
            : `Kein Wert konfiguriert – sicherer Code-Default aktiv`,
      };
    }

    return {
      key: definition.key,
      value: undefined,
      source: 'DEFAULT',
      reason: 'Kein Wert konfiguriert – optionale Funktion ist deaktiviert (Degradation)',
    };
  }
}
