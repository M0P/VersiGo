import { Injectable } from '@nestjs/common';
import { AppConfigService, SettingsResolverService, type AppConfig } from '../config';

export type CapabilityKey =
  | 'oidc'
  | 'local'
  | 'ai'
  | 'paperless'
  | 'storage'
  | 'familySharing';

/**
 * Zuordnung jeder Capability zu ihrem Settings-Katalog-Schluessel. Der
 * Resolver (UI > ENV > DEFAULT) ist die alleinige Quelle fuer An/Aus-
 * Auskunft; `AppConfigService` dient ausschliesslich als Fallback fuer
 * Schluessel ohne statischen Katalog-Default (z. B. LOCAL_AUTH_ENABLED,
 * dessen Default von NODE_ENV abgeleitet ist).
 */
const CAPABILITY_TO_SETTING: Record<CapabilityKey, string> = {
  oidc: 'OIDC_ENABLED',
  local: 'LOCAL_AUTH_ENABLED',
  ai: 'AI_ENABLED',
  paperless: 'PAPERLESS_ENABLED',
  storage: 'STORAGE_ENABLED',
  familySharing: 'FAMILY_SHARING_ENABLED',
};

/**
 * Zentrale Auskunftstelle darueber, ob eine optionale Integration
 * aktiviert ist. Enthaelt keine Fachlogik der jeweiligen Integration,
 * nur die reine An/Aus-Auskunft.
 *
 * BugFix-05: Die Aufloesung erfolgt ueber den SettingsResolverService
 * (deterministische Kette UI > ENV > DEFAULT, AP-17) statt ueber den
 * Env-Snapshot von AppConfigService. Damit spiegeln per Admin-UI
 * gesetzte Werte (z. B. AI_ENABLED) die Capability-Flags sofort wider
 * und sind ueberall konsistent (Auth-Config, Monitoring, OIDC-Strategie,
 * Health/Readiness). Alle Methoden sind asynchron, weil die Aufloesung
 * Datenbankzugriffe umfassen kann.
 */
@Injectable()
export class CapabilityFlagsService {
  constructor(
    private readonly settings: SettingsResolverService,
    private readonly config: AppConfigService,
  ) {}

  /** Effektiver Zustand einer Capability (UI-Override > ENV > Default). */
  async isEnabled(capability: CapabilityKey): Promise<boolean> {
    const settingKey = CAPABILITY_TO_SETTING[capability];
    const resolved = await this.settings.getEffectiveBoolean(settingKey);
    if (resolved !== undefined) return resolved;
    // Fallback: NODE_ENV-abgeleitete Defaults (z. B. lokale Auth im
    // Dev-/Test-Modus), fuer die der Katalog keinen statischen Default
    // fuehrt. Ohne Fallback wuerde LOCAL_AUTH_ENABLED in Dev fälschlich
    // als deaktiviert gemeldet und der Identity-Fail-Fast ausloesen.
    return Boolean(this.config.get(settingKey as keyof AppConfig));
  }

  /** Gebuendelte An/Aus-Auskunft ueber alle Capabilities (ein DB-Zugriff). */
  async snapshot(): Promise<Record<CapabilityKey, boolean>> {
    const settingKeys = [...new Set(Object.values(CAPABILITY_TO_SETTING))];
    const resolutions = await this.settings.resolveMany(settingKeys);
    const result = {} as Record<CapabilityKey, boolean>;
    for (const [capability, settingKey] of Object.entries(CAPABILITY_TO_SETTING) as Array<
      [CapabilityKey, string]
    >) {
      const resolution = resolutions.get(settingKey);
      const effective =
        resolution?.value !== undefined && resolution.value !== null
          ? Boolean(resolution.value)
          : Boolean(this.config.get(settingKey as keyof AppConfig));
      result[capability] = effective;
    }
    return result;
  }
}
