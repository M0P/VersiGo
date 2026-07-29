import { describe, expect, it } from 'vitest';
import { parseAppConfig } from '../app-config.schema';

const validKey = 'a'.repeat(64);

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/insura',
  REDIS_URL: 'redis://localhost:6379',
  SETTINGS_ENCRYPTION_KEY: validKey,
  SESSION_SECRET: 'a'.repeat(32),
};

describe('parseAppConfig', () => {
  it('akzeptiert eine minimal gueltige Konfiguration', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.DATABASE_URL).toBe(baseEnv.DATABASE_URL);
    expect(config.OIDC_ENABLED).toBe(false);
    expect(config.AI_ENABLED).toBe(false);
  });

  it('wirft einen Fehler bei fehlender DATABASE_URL', () => {
    const env = { ...baseEnv, DATABASE_URL: undefined };
    expect(() => parseAppConfig(env as Record<string, string | undefined>)).toThrow(
      /DATABASE_URL/,
    );
  });

  it('wirft einen Fehler bei ungueltigem SETTINGS_ENCRYPTION_KEY', () => {
    const env = { ...baseEnv, SETTINGS_ENCRYPTION_KEY: 'zu-kurz' };
    expect(() => parseAppConfig(env)).toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });

  it('parst boolesche Feature-Flags aus String-Env-Variablen', () => {
    const env = { ...baseEnv, OIDC_ENABLED: 'true', AI_ENABLED: 'false' };
    const config = parseAppConfig(env);
    expect(config.OIDC_ENABLED).toBe(true);
    expect(config.AI_ENABLED).toBe(false);
  });

  it('setzt Default fuer NODE_ENV auf development', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.NODE_ENV).toBe('development');
  });

  it('wirft einen Fehler bei ungueltigem Boolean-String statt stillschweigend false zu setzen', () => {
    const env = { ...baseEnv, AI_ENABLED: 'flase' };
    expect(() => parseAppConfig(env)).toThrow(/AI_ENABLED/);
  });

  it('akzeptiert Boolean-Strings case-insensitive', () => {
    const env = { ...baseEnv, AI_ENABLED: 'TRUE' };
    const config = parseAppConfig(env);
    expect(config.AI_ENABLED).toBe(true);
  });
});
