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
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/insura',
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
    // restart-Katalog: LOCAL_AUTH_MAX_ATTEMPTS (Zahl 1-100),
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

  it('ueberspringt ungueltige DB-Werte statt sie in die Umgebung zu schreiben (Fail-soft)', async () => {
    const restartKeys = getRestartRequiredKeys();
    const env = baseEnv();
    findMany.mockResolvedValue([
      { key: restartKeys[0], valueEncrypted: null, valuePlain: 'banana' }, // keine Zahl
      { key: restartKeys[1], valueEncrypted: null, valuePlain: '0' }, // unterhalb Min (1000)
      { key: restartKeys[2], valueEncrypted: null, valuePlain: 'yes' }, // kein Boolean
    ]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(0);
    expect(env[restartKeys[0]]).toBeUndefined();
    expect(env[restartKeys[1]]).toBeUndefined();
    expect(env[restartKeys[2]]).toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('ueberspringt nicht katalogisierte Schluessel aus Legacy-Daten (Allowlist)', async () => {
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

  it('ueberspringt leere Werte und trennt die Verbindung trotzdem', async () => {
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

  it('gibt 0 zurueck, wenn keine DB-Zeilen existieren', async () => {
    const env = baseEnv();
    findMany.mockResolvedValue([]);

    const applied = await preloadRestartSettingsIntoEnv(env);

    expect(applied).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('gibt 0 zurueck, wenn DATABASE_URL fehlt (kein DB-Zugriff)', async () => {
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
    // findMany loest nie auf – simuliert einen haengenden DB-Zugriff.
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
