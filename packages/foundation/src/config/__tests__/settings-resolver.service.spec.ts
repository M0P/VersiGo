import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SettingsResolverService } from '../settings-resolver.service';

function createMockDb() {
  return {
    globalIntegrationSetting: { findUnique: vi.fn() },
  };
}

function createMockEncryption(decryptImpl?: (cipher: string) => Promise<string>) {
  return {
    encrypt: vi.fn(),
    decrypt: vi.fn(async (cipher: string) => cipher),
    ...(decryptImpl ? { decrypt: vi.fn(decryptImpl) } : {}),
  };
}

const envWithAiEnabled = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/versigo',
  REDIS_URL: 'redis://localhost:6379',
  SETTINGS_ENCRYPTION_KEY: 'a'.repeat(64),
  AI_ENABLED: 'true',
};

describe('SettingsResolverService', () => {
  let db: ReturnType<typeof createMockDb>;
  let encryption: ReturnType<typeof createMockEncryption>;

  beforeEach(() => {
    db = createMockDb();
    encryption = createMockEncryption();
  });

  function createService(env: Record<string, string | undefined> = envWithAiEnabled) {
    return new SettingsResolverService(db as never, encryption as never, env);
  }

  describe('Prioritaet UI > ENV > DEFAULT', () => {
    it('a valid UI value wins against .env', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'AI_ENABLED',
        valuePlain: 'false',
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: 'true' });

      const resolution = await service.resolve('AI_ENABLED');

      expect(resolution.value).toBe(false);
      expect(resolution.source).toBe('UI');
      expect(resolution.uiValuePresent).toBe(true);
      expect(resolution.uiValueInvalid).toBe(false);
      expect(resolution.uiUpdatedAt).not.toBeNull();
    });

    it('falls back to .env when no UI value exists', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: 'true' });

      const resolution = await service.resolve('AI_ENABLED');

      expect(resolution.value).toBe(true);
      expect(resolution.source).toBe('ENV');
      expect(resolution.reason).toContain('.env');
      expect(resolution.uiValuePresent).toBe(false);
    });

    it('falls back to the default when neither UI nor .env exist', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: undefined });

      const resolution = await service.resolve('AI_ENABLED');

      expect(resolution.value).toBe(false);
      expect(resolution.source).toBe('DEFAULT');
      expect(resolution.reason).toContain('Default');
    });

    it('ignores an invalid UI value and reports it as invalid', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'AI_ENABLED',
        valuePlain: 'not-a-boolean',
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date('2026-01-03T00:00:00Z'),
      });
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: 'true' });

      const resolution = await service.resolve('AI_ENABLED');

      expect(resolution.value).toBe(true); // ENV bleibt aktiv
      expect(resolution.source).toBe('ENV');
      expect(resolution.uiValueInvalid).toBe(true);
      expect(resolution.uiValuePresent).toBe(true);
    });

    it('ignores an invalid .env value in favor of the default', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: 'garbage' });

      const resolution = await service.resolve('AI_ENABLED');

      expect(resolution.value).toBe(false);
      expect(resolution.source).toBe('DEFAULT');
      expect(resolution.reason).toContain('ungueltig');
    });

    it('treats empty .env values like "unset" (Compose behavior)', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: '' });

      const resolution = await service.resolve('AI_ENABLED');

      expect(resolution.source).toBe('DEFAULT');
      expect(resolution.value).toBe(false);
    });
  });

  describe('Typvalidierung', () => {
    it('validates numbers against min/max from the catalog', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'AI_EXTRACTION_TIMEOUT_MS',
        valuePlain: '5', // unterhalb des Minimums von 1000
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date(),
      });
      const service = createService({ ...envWithAiEnabled, AI_EXTRACTION_TIMEOUT_MS: '60000' });

      const resolution = await service.resolve('AI_EXTRACTION_TIMEOUT_MS');

      expect(resolution.source).toBe('ENV');
      expect(resolution.value).toBe(60000);
      expect(resolution.uiValueInvalid).toBe(true);
    });

    it('validiert Strings gegen allowedValues', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'AI_PROVIDER',
        valuePlain: 'unsupported-provider',
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date(),
      });
      const service = createService({ ...envWithAiEnabled, AI_PROVIDER: 'ollama' });

      const resolution = await service.resolve('AI_PROVIDER');

      expect(resolution.source).toBe('ENV');
      expect(resolution.value).toBe('ollama');
      expect(resolution.uiValueInvalid).toBe(true);
    });
  });

  describe('Secrets', () => {
    it('decrypts encrypted secret values for feature consumers', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'PAPERLESS_API_TOKEN',
        valuePlain: null,
        valueEncrypted: 'encrypted-token',
        isSecret: true,
        updatedAt: new Date(),
      });
      encryption = createMockEncryption(async (cipher: string) => `decrypted:${cipher}`);
      const service = createService({ ...envWithAiEnabled, PAPERLESS_API_TOKEN: undefined });

      const resolution = await service.resolve('PAPERLESS_API_TOKEN');

      expect(resolution.value).toBe('decrypted:encrypted-token');
      expect(resolution.source).toBe('UI');
      expect(encryption.decrypt).toHaveBeenCalledWith('encrypted-token');
    });
  });

  describe('Typisierte Accessoren', () => {
    it('getEffectiveBoolean returns only boolean values', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_ENABLED: 'true' });

      await expect(service.getEffectiveBoolean('AI_ENABLED')).resolves.toBe(true);
    });

    it('getEffectiveString returns only strings', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_PROVIDER: 'openai-compat' });

      await expect(service.getEffectiveString('AI_PROVIDER')).resolves.toBe('openai-compat');
    });

    it('getEffectiveNumber returns only numbers', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      const service = createService({ ...envWithAiEnabled, AI_MAX_RETRIES: '7' });

      await expect(service.getEffectiveNumber('AI_MAX_RETRIES')).resolves.toBe(7);
    });
  });

  describe('Allowlist', () => {
    it('throws for unknown keys', async () => {
      const service = createService();

      await expect(service.resolve('UNKNOWN_KEY')).rejects.toThrow(/catalog|allowlist/);
    });
  });

  describe('restart category (active only after restart)', () => {
    it('returns the active ENV/default value and the pending restart value', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'STORAGE_ENABLED',
        valuePlain: 'true',
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date('2026-01-05T00:00:00Z'),
      });
      const service = createService({ ...envWithAiEnabled, STORAGE_ENABLED: undefined });

      const resolution = await service.resolve('STORAGE_ENABLED');

      // The default stays active until the restart – the DB value is NOT
      // bereits wirksam dargestellt.
      expect(resolution.value).toBe(false);
      expect(resolution.source).toBe('DEFAULT');
      expect(resolution.pendingRestartValue).toBe(true);
      expect(resolution.uiValuePresent).toBe(true);
      expect(resolution.uiValueInvalid).toBe(false);
      expect(resolution.reason).toContain('nach Neustart');
    });

    it('uses the ENV value as active when a restart UI value is pending', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'LOCAL_AUTH_MAX_ATTEMPTS',
        valuePlain: '10',
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date('2026-01-05T00:00:00Z'),
      });
      const service = createService({ ...envWithAiEnabled, LOCAL_AUTH_MAX_ATTEMPTS: '3' });

      const resolution = await service.resolve('LOCAL_AUTH_MAX_ATTEMPTS');

      expect(resolution.value).toBe(3); // ENV bleibt aktiv
      expect(resolution.source).toBe('ENV');
      expect(resolution.pendingRestartValue).toBe(10);
    });

    it('marks an invalid restart UI value without applying it', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'STORAGE_ENABLED',
        valuePlain: 'yes', // not a boolean
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date(),
      });
      const service = createService({ ...envWithAiEnabled, STORAGE_ENABLED: undefined });

      const resolution = await service.resolve('STORAGE_ENABLED');

      expect(resolution.value).toBe(false);
      expect(resolution.uiValueInvalid).toBe(true);
      expect(resolution.uiValuePresent).toBe(true);
      expect(resolution.pendingRestartValue).toBeUndefined();
    });

    it('suppresses pendingRestartValue when the DB value is already active (after restart)', async () => {
      db.globalIntegrationSetting.findUnique.mockResolvedValue({
        key: 'LOCAL_AUTH_MAX_ATTEMPTS',
        valuePlain: '3', // identical to the active ENV value
        valueEncrypted: null,
        isSecret: false,
        updatedAt: new Date('2026-01-05T00:00:00Z'),
      });
      const service = createService({ ...envWithAiEnabled, LOCAL_AUTH_MAX_ATTEMPTS: '3' });

      const resolution = await service.resolve('LOCAL_AUTH_MAX_ATTEMPTS');

      expect(resolution.value).toBe(3); // ENV value is active
      expect(resolution.source).toBe('ENV');
      // m8: nothing pending – the value is already effective.
      expect(resolution.pendingRestartValue).toBeUndefined();
      expect(resolution.reason).toContain('bereits aktiv');
      expect(resolution.reason).not.toContain('nach Neustart');
    });
  });

  describe('resolveMany (gebundelte Aufloesung)', () => {
    it('resolves multiple keys with a single DB access', async () => {
      const batchedDb = {
        globalIntegrationSetting: {
          findUnique: vi.fn(),
          findMany: vi.fn().mockResolvedValue([
            {
              key: 'AI_ENABLED',
              valuePlain: 'true',
              valueEncrypted: null,
              isSecret: false,
              updatedAt: new Date(),
            },
            {
              key: 'AI_PROVIDER',
              valuePlain: null,
              valueEncrypted: null,
              isSecret: false,
              updatedAt: new Date(),
            },
          ]),
        },
      };
      const service = new SettingsResolverService(
        batchedDb as never,
        encryption as never,
        envWithAiEnabled,
      );

      const result = await service.resolveMany(['AI_ENABLED', 'AI_PROVIDER']);

      expect(batchedDb.globalIntegrationSetting.findMany).toHaveBeenCalledTimes(1);
      expect(result.size).toBe(2);
      expect(result.get('AI_ENABLED')?.value).toBe(true);
      expect(result.get('AI_ENABLED')?.source).toBe('UI');
      expect(result.get('AI_PROVIDER')?.value).toBe('ollama'); // Code-Default
      expect(result.get('AI_PROVIDER')?.source).toBe('DEFAULT');
    });

    it('throws for unknown keys (allowlist)', async () => {
      const batchedDb = {
        globalIntegrationSetting: {
          findUnique: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new SettingsResolverService(
        batchedDb as never,
        encryption as never,
        envWithAiEnabled,
      );

      await expect(service.resolveMany(['AI_ENABLED', 'NOPE'])).rejects.toThrow(
        /catalog|allowlist/,
      );
    });
  });
});
