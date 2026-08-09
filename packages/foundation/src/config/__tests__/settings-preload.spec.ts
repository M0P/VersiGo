import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const disconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    globalIntegrationSetting: { findMany },
    $disconnect: disconnect,
  })),
}));

import { preloadRestartSettingsIntoEnv } from '../settings-preload';
import { getRestartRequiredKeys } from '../settings-catalog';

function baseEnv(): Record<string, string | undefined> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/versigo',
    SETTINGS_ENCRYPTION_KEY: 'a'.repeat(64),
    // Vom AppConfigService (Validation) zwingend gefordert.
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'x'.repeat(48),
  };
}

describe('preloadRestartSettingsIntoEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnect.mockResolvedValue(undefined);
  });

  it('wendet katalogisierte restart-Settings aus der DB auf die Umgebung an', async () => {
    const restartKeys = getRestartRequiredKeys();
    const env = baseEnv();
    // First restart catalog keys: LOCAL_AUTH_MAX_ATTEMPTS (number 1-100),
    // LOCAL_AUTH_RATE_LIMIT_WINDOW_MS (Zahl 1000-86400000), STORAGE_ENABLED (Boolean).
    findMany.mockResolvedValue([
      { key: restartKeys[0], valueEncrypted: null, valuePlain: '42' },
      { key: restartKeys[1], valueEncrypted: null, valuePlain: '90000' },
      { key: restartKeys[2], valueEncrypted: null, valuePlain: 'true' },
    ]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(3);
    expect(env[restartKeys[0]]).toBe('42');
    expect(env[restartKeys[1]]).toBe('90000');
    expect(env[restartKeys[2]]).toBe('true');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { in: expect.any(Array) } } }),
    );
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('skips invalid DB values instead of writing them into the environment (fail-soft)', async () => {
    const restartKeys = getRestartRequiredKeys();
    const env = baseEnv();
    findMany.mockResolvedValue([
      { key: restartKeys[0], valueEncrypted: null, valuePlain: 'banana' }, // not a number
      { key: restartKeys[1], valueEncrypted: null, valuePlain: '0' }, // unterhalb Min (1000)
      { key: restartKeys[2], valueEncrypted: null, valuePlain: 'yes' }, // not a boolean
    ]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(0);
    expect(env[restartKeys[0]]).toBeUndefined();
    expect(env[restartKeys[1]]).toBeUndefined();
    expect(env[restartKeys[2]]).toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('skips non-catalogued keys from legacy data (allowlist)', async () => {
    const restartKeys = getRestartRequiredKeys();
    const env = baseEnv();
    findMany.mockResolvedValue([
      { key: 'ARBITRARY_LEGACY_KEY', valueEncrypted: null, valuePlain: '42' },
      { key: restartKeys[0], valueEncrypted: null, valuePlain: '7' },
    ]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(1);
    expect(env['ARBITRARY_LEGACY_KEY']).toBeUndefined();
    expect(env[restartKeys[0]]).toBe('7');
  });

  it('skips empty values and still disconnects', async () => {
    const restartKeys = getRestartRequiredKeys();
    const env = baseEnv();
    findMany.mockResolvedValue([
      { key: restartKeys[0], valueEncrypted: null, valuePlain: '  ' },
      { key: restartKeys[1], valueEncrypted: null, valuePlain: null },
    ]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(0);
    expect(env[restartKeys[0]]).toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when no DB rows exist', async () => {
    const env = baseEnv();
    findMany.mockResolvedValue([]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when DATABASE_URL is missing (no DB access)', async () => {
    const env: Record<string, string | undefined> = {
      SETTINGS_ENCRYPTION_KEY: 'a'.repeat(64),
    };

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('bricht bei haengendem DB-Zugriff nach Ablauf der Zeit-Obergrenze ab (Fail-soft)', async () => {
    const restartKeys = getRestartRequiredKeys();
    const env = baseEnv();
    // findMany never resolves – simulates a hanging DB access.
    findMany.mockReturnValue(new Promise(() => undefined));
    const startedAt = Date.now();

    const applied = await preloadRestartSettingsIntoEnv(env, 100);

    const elapsed = Date.now() - startedAt;
    expect(applied).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(5_000);
    expect(env[restartKeys[0]]).toBeUndefined();
  });
});
