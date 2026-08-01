import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database';
import { ENCRYPTION_PORT, type EncryptionPort } from '../encryption/encryption.port';
import { getSettingDefinition, type SettingDefinition } from './settings-catalog';
import { validateSettingValue } from './settings-validation';

/**
 * Zentrale Konfigurationsaufloesung (AP-17).
 *
 * Deterministische Prioritaetskette fuer JEDEN katalogisierten Schluessel:
 *   1. gueltiger, aktivierter, datenbankgestuetzter UI-Wert gewinnt,
 *   2. sonst gilt der validierte `.env`-Wert als Fallback,
 *   3. sonst ausschliesslich der sichere, dokumentierte Code-Default
 *      oder die betroffene optionale Funktion degradiert.
 *
 * API und Worker verwenden exakt diese Aufloesung – Features lesen niemals
 * direkt `process.env` und umgehen damit keine UI-Overrides. Secrets werden
 * intern entschluesselt und nur an berechtigte Feature-Konsumenten
 * zurueckgegeben; die Admin-UI maskiert sie grundsaetzlich.
 *
 * Ein ungueltiger UI-Wert aktiviert NIE einen defekten effektiven Zustand:
 * er wird uebersprungen, die zuvor wirksame Konfiguration (ENV/Default)
 * bleibt aktiv und `uiValueInvalid` macht den Fehler administrativ sichtbar.
 */

export type SettingSource = 'UI' | 'ENV' | 'DEFAULT';

export interface SettingResolution {
  key: string;
  /** Effektiver, validierter Wert (undefined = nicht verfuegbar -> Degradation). */
  value: string | number | boolean | undefined;
  /** Quelle des effektiven Werts. */
  source: SettingSource;
  /** Menschenlesbarer Grund fuer die Admin-UI (deutsch). */
  reason: string;
  /** Ein validierter UI-Wert ist aktiv. */
  uiValuePresent: boolean;
  /** UI-Wert vorhanden, aber ungueltig (wird ignoriert; ENV/Default aktiv). */
  uiValueInvalid: boolean;
  /** Zeitpunkt der letzten UI-Aenderung (falls vorhanden). */
  uiUpdatedAt: Date | null;
  /**
   * Nur restart-Kategorie: validierter UI-Wert, der erst beim naechsten
   * Prozessstart aktiv wird (Boot-Preload). `value`/`source` beschreiben
   * bis dahin den tatsaechlich aktiven Wert (ENV/Default) – der
   * Neustart-Wert wird nie fälschlich als bereits aktiv dargestellt.
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
   * Volloaufloesung eines katalogisierten Schluessels.
   * Wirft einen Fehler fuer unbekannte (nicht katalogisierte) Schluessel –
   * die Allowlist gilt ausnahmslos.
   */
  async resolve(key: string): Promise<SettingResolution> {
    const definition = getSettingDefinition(key);
    if (!definition) {
      throw new Error(`Unbekannter Settings-Schluessel '${key}' – nicht im Katalog (Allowlist).`);
    }

    const stored = await this.db.globalIntegrationSetting.findUnique({ where: { key } });
    return this.resolveStored(definition, stored);
  }

  /**
   * Gebuendelte Aufloesung mehrerer Schluessel mit EINEM Datenbank-Zugriff
   * (vermeidet N+1 Round-Trips, z. B. fuer die Katalogansicht der Admin-UI).
   * Wirft wie `resolve` fuer unbekannte Schluessel.
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
        throw new Error(`Unbekannter Settings-Schluessel '${key}' – nicht im Katalog (Allowlist).`);
      }
      results.set(key, await this.resolveStored(definition, storedByKey.get(key) ?? null));
    }
    return results;
  }

  /** Effektiver String-Wert (z. B. URLs, Modelle, Provider). */
  async getEffectiveString(key: string): Promise<string | undefined> {
    const resolution = await this.resolve(key);
    return typeof resolution.value === 'string' ? resolution.value : undefined;
  }

  /** Effektiver Boolean-Wert (z. B. Feature-Schalter). */
  async getEffectiveBoolean(key: string): Promise<boolean | undefined> {
    const resolution = await this.resolve(key);
    return typeof resolution.value === 'boolean' ? resolution.value : undefined;
  }

  /** Effektiver numerischer Wert (z. B. Timeouts, Limits). */
  async getEffectiveNumber(key: string): Promise<number | undefined> {
    const resolution = await this.resolve(key);
    return typeof resolution.value === 'number' ? resolution.value : undefined;
  }

  // --- Intern ---

  /**
   * Aufloesung gegen eine bereits geladene DB-Zeile (oder null). Gemeinsame
   * Logik von `resolve` und `resolveMany`.
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
            // Restart-Kategorie: Der DB-Wert wird erst beim naechsten
            // Prozessstart aktiv (Boot-Preload). Bis dahin bleibt der
            // ENV-/Default-Wert wirksam; der neue Wert wird explizit als
            // "nach Neustart" (pendingRestartValue) geliefert und niemals
            // als bereits aktiv dargestellt.
            const active = await this.resolveEnvOrDefault(definition);
            // m8: Ist der DB-Wert bereits aktiv (identisch zu .env/Default –
            // z. B. weil der Preload ihn nach einem Neustart in die Umgebung
            // geschrieben hat), gibt es nichts Pendentes.
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
        // Ungueltiger UI-Wert: ignorieren, ENV/Default aktiv lassen.
        this.logger.warn(
          `UI-Wert fuer '${definition.key}' ungueltig (${coerced.error}) – ENV/Default bleibt aktiv.`,
        );
        const fallback = await this.resolveEnvOrDefault(definition);
        return {
          ...fallback,
          uiValuePresent: true,
          uiValueInvalid: true,
          uiUpdatedAt: stored.updatedAt,
        };
      }
      // Stored-Zeile ohne verwertbaren Wert: wie "nicht gesetzt" behandeln.
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
      // Ungueltiger Env-Wert: auf sicheren Default degradieren.
      this.logger.warn(
        `Env-Wert fuer '${definition.envVar}' ungueltig (${coerced.error}) – Default wird verwendet.`,
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
