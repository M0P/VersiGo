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
 * Maps each capability to its settings-catalog key. The
 * resolver (UI > ENV > DEFAULT) is the sole source of truth for
 * on/off state; `AppConfigService` is used only as a fallback for
 * keys without a static catalog default (e.g. LOCAL_AUTH_ENABLED,
 * whose default is derived from NODE_ENV).
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
 * Central authority on whether an optional integration is enabled.
 * Contains no domain logic of the individual integration, only the
 * pure on/off state.
 *
 * BugFix-05: Resolution goes through the SettingsResolverService
 * (deterministic chain UI > ENV > DEFAULT, AP-17) instead of the
 * env snapshot from AppConfigService. Values set via the admin UI
 * (e.g. AI_ENABLED) therefore immediately reflect in the capability
 * flags and are consistent everywhere (auth config, monitoring,
 * OIDC strategy, health/readiness). All methods are async because
 * resolution may involve database access.
 */
@Injectable()
export class CapabilityFlagsService {
  constructor(
    private readonly settings: SettingsResolverService,
    private readonly config: AppConfigService,
  ) {}

  /** Effective state of a capability (UI override > ENV > default). */
  async isEnabled(capability: CapabilityKey): Promise<boolean> {
    const settingKey = CAPABILITY_TO_SETTING[capability];
    const resolved = await this.settings.getEffectiveBoolean(settingKey);
    if (resolved !== undefined) return resolved;
    // Fallback: NODE_ENV-derived defaults (e.g. local auth in dev/test
    // mode) for which the catalog carries no static default. Without
    // this fallback, LOCAL_AUTH_ENABLED would be reported as disabled
    // in dev and would trigger the identity fail-fast.
    return Boolean(this.config.get(settingKey as keyof AppConfig));
  }

  /** Bundled on/off state for all capabilities (single DB access). */
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
