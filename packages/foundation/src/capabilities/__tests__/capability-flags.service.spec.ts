import { describe, expect, it, vi } from 'vitest';
import { AppConfigService } from '../../config';
import { CapabilityFlagsService } from '../capability-flags.service';

const validKey = 'a'.repeat(64);

function buildConfig(overrides: Record<string, string> = {}): AppConfigService {
  return new AppConfigService({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/versigo',
    REDIS_URL: 'redis://localhost:6379',
    SETTINGS_ENCRYPTION_KEY: validKey,
    SESSION_SECRET: 'a'.repeat(32),
    ...overrides,
  });
}

/**
 * Stand-in for the SettingsResolverService (BugFix-05): capability
 * resolution runs through the resolver (UI > ENV > DEFAULT). The fallback to
 * AppConfigService is only used for keys without a static catalog default
 * (e.g. LOCAL_AUTH_ENABLED with a NODE_ENV-derived default).
 */
function createService(options: {
  effectiveBooleans?: Record<string, boolean | undefined>;
  resolutions?: Map<string, unknown>;
  config?: AppConfigService;
} = {}) {
  const settings = {
    getEffectiveBoolean: vi.fn().mockImplementation(async (key: string) => {
      if (!options.effectiveBooleans) return undefined;
      const value = options.effectiveBooleans[key];
      // undefined = not configured -> resolver returns no value
      return value;
    }),
    resolveMany: vi.fn().mockImplementation(async () => {
      const map = new Map<string, unknown>();
      const booleans = options.effectiveBooleans ?? {};
      for (const [key, value] of Object.entries(booleans)) {
        map.set(key, value === undefined ? null : { value });
      }
      for (const [key, value] of options.resolutions ?? new Map()) {
        map.set(key, value);
      }
      return map;
    }),
  };
  const config = options.config ?? buildConfig();
  const service = new CapabilityFlagsService(
    settings as never,
    config as never,
  );
  return { service, settings, config };
}

describe('CapabilityFlagsService', () => {
  it('reports all capabilities as disabled when the resolver knows nothing and production is not configured', async () => {
    const { service } = createService({
      config: buildConfig({ NODE_ENV: 'production' }),
    });
    expect(await service.snapshot()).toEqual({
      oidc: false,
      local: false,
      ai: false,
      paperless: false,
      storage: false,
      familySharing: true,
    });
  });

  it('enables local auth in dev mode via the AppConfig fallback (no catalog default)', async () => {
    const { service } = createService({
      config: buildConfig({ NODE_ENV: 'development' }),
    });
    expect(await service.isEnabled('local')).toBe(true);
    expect(await service.isEnabled('oidc')).toBe(false);
  });

  it('reports an enabled capability correctly', async () => {
    const { service } = createService({
      effectiveBooleans: { AI_ENABLED: true, PAPERLESS_ENABLED: false },
    });
    expect(await service.isEnabled('ai')).toBe(true);
    expect(await service.isEnabled('paperless')).toBe(false);
  });

  it('spiegelt UI-Overrides (Resolver) statt des Env-Snapshots wider', async () => {
    const { service, settings } = createService({
      // Env says false (AppConfig default), UI value says true -> resolver wins.
      config: buildConfig({ NODE_ENV: 'production' }),
      effectiveBooleans: { AI_ENABLED: true },
    });
    expect(await service.isEnabled('ai')).toBe(true);
    expect(settings.getEffectiveBoolean).toHaveBeenCalledWith('AI_ENABLED');
  });

  it('snapshot nutzt resolveMany (ein DB-Zugriff) und enthaelt alle Capabilities', async () => {
    const { service, settings } = createService({
      effectiveBooleans: {
        OIDC_ENABLED: false,
        LOCAL_AUTH_ENABLED: true,
        AI_ENABLED: true,
        PAPERLESS_ENABLED: false,
        STORAGE_ENABLED: false,
        FAMILY_SHARING_ENABLED: true,
      },
    });
    const snapshot = await service.snapshot();
    expect(settings.resolveMany).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      oidc: false,
      local: true,
      ai: true,
      paperless: false,
      storage: false,
      familySharing: true,
    });
  });

  it('falls back to the AppConfig default when the resolver has no answer', async () => {
    const { service } = createService({
      config: buildConfig({ NODE_ENV: 'production', STORAGE_ENABLED: 'false' }),
    });
    // Resolver returns undefined -> AppConfig fallback applies
    expect(await service.isEnabled('storage')).toBe(false);
  });
});
