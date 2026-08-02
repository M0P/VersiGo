import { describe, expect, it } from 'vitest';
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

describe('CapabilityFlagsService', () => {
  it('meldet alle Capabilities als deaktiviert, wenn in Produktion nichts konfiguriert ist', () => {
    // In Produktion bleibt die lokale Auth deaktiviert, bis sie explizit
    // gesetzt wird (LOCAL_AUTH_ENABLED). Im Dev-/Test-Modus ist sie der
    // Standard (siehe app-config.schema.spec.ts).
    const service = new CapabilityFlagsService(buildConfig({ NODE_ENV: 'production' }));
    expect(service.snapshot()).toEqual({
      oidc: false,
      local: false,
      ai: false,
      paperless: false,
      storage: false,
    });
  });

  it('aktiviert lokale Auth im Dev-Modus standardmaessig', () => {
    const service = new CapabilityFlagsService(buildConfig({ NODE_ENV: 'development' }));
    expect(service.isEnabled('local')).toBe(true);
    expect(service.isEnabled('oidc')).toBe(false);
  });

  it('meldet aktivierte Capability korrekt', () => {
    const service = new CapabilityFlagsService(buildConfig({ AI_ENABLED: 'true' }));
    expect(service.isEnabled('ai')).toBe(true);
    expect(service.isEnabled('paperless')).toBe(false);
  });
});
