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
 * Stellvertreter fuer den SettingsResolverService (BugFix-05): Die Capability-
 * Aufloesung laeuft ueber den Resolver (UI > ENV > DEFAULT). Der Fallback auf
 * AppConfigService wird nur fuer Schluessel ohne statischen Katalog-Default
 * wirksam (z. B. LOCAL_AUTH_ENABLED mit NODE_ENV-abgeleitetem Default).
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
      // undefined = nicht konfiguriert -> Resolver liefert keinen Wert
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
  it('meldet alle Capabilities als deaktiviert, wenn der Resolver nichts kennt und in Produktion nichts konfiguriert ist', async () => {
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

  it('aktiviert lokale Auth im Dev-Modus ueber den AppConfig-Fallback (kein Katalog-Default)', async () => {
    const { service } = createService({
      config: buildConfig({ NODE_ENV: 'development' }),
    });
    expect(await service.isEnabled('local')).toBe(true);
    expect(await service.isEnabled('oidc')).toBe(false);
  });

  it('meldet aktivierte Capability korrekt', async () => {
    const { service } = createService({
      effectiveBooleans: { AI_ENABLED: true, PAPERLESS_ENABLED: false },
    });
    expect(await service.isEnabled('ai')).toBe(true);
    expect(await service.isEnabled('paperless')).toBe(false);
  });

  it('spiegelt UI-Overrides (Resolver) statt des Env-Snapshots wider', async () => {
    const { service, settings } = createService({
      // Env sagt false (AppConfig-Default), UI-Wert sagt true -> Resolver gewinnt.
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

  it('faellt bei fehlender Resolver-Auskunft auf den AppConfig-Default zurueck', async () => {
    const { service } = createService({
      config: buildConfig({ NODE_ENV: 'production', STORAGE_ENABLED: 'false' }),
    });
    // Resolver liefert undefined -> AppConfig-Fallback greift
    expect(await service.isEnabled('storage')).toBe(false);
  });
});
