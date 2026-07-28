import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../config';
import { CapabilityFlagsService } from '../capability-flags.service';

const validKey = 'a'.repeat(64);

function buildConfig(overrides: Record<string, string> = {}): AppConfigService {
  return new AppConfigService({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/insura',
    REDIS_URL: 'redis://localhost:6379',
    SETTINGS_ENCRYPTION_KEY: validKey,
    ...overrides,
  });
}

describe('CapabilityFlagsService', () => {
  it('meldet alle Capabilities als deaktiviert, wenn nichts konfiguriert ist', () => {
    const service = new CapabilityFlagsService(buildConfig());
    expect(service.snapshot()).toEqual({
      oidc: false,
      ai: false,
      paperless: false,
      storage: false,
    });
  });

  it('meldet aktivierte Capability korrekt', () => {
    const service = new CapabilityFlagsService(buildConfig({ AI_ENABLED: 'true' }));
    expect(service.isEnabled('ai')).toBe(true);
    expect(service.isEnabled('paperless')).toBe(false);
  });
});
