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

  it('setzt LOCAL_AUTH_ENABLED im Dev-Modus auf true, wenn nicht gesetzt', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'development' });
    expect(config.LOCAL_AUTH_ENABLED).toBe(true);
  });

  it('setzt LOCAL_AUTH_ENABLED im Test-Modus auf true, wenn nicht gesetzt', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'test' });
    expect(config.LOCAL_AUTH_ENABLED).toBe(true);
  });

  it('laesst LOCAL_AUTH_ENABLED in Produktion deaktiviert, wenn nicht gesetzt', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'production' });
    expect(config.LOCAL_AUTH_ENABLED).toBe(false);
  });

  it('gibt einer explizit gesetzten LOCAL_AUTH_ENABLED-Variable Vorrang', () => {
    const env = { ...baseEnv, NODE_ENV: 'development', LOCAL_AUTH_ENABLED: 'false' };
    const config = parseAppConfig(env);
    expect(config.LOCAL_AUTH_ENABLED).toBe(false);
  });

  it('setzt OIDC_ENABLED auf false, wenn nicht gesetzt', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.OIDC_ENABLED).toBe(false);
  });

  it('gibt einer explizit gesetzten OIDC_ENABLED-Variable Vorrang', () => {
    const env = { ...baseEnv, OIDC_ENABLED: 'true' };
    const config = parseAppConfig(env);
    expect(config.OIDC_ENABLED).toBe(true);
  });

  it('behandelt leere Auth-Flag-Strings wie nicht gesetzte Variablen', () => {
    const env = {
      ...baseEnv,
      LOCAL_AUTH_ENABLED: '',
      OIDC_ENABLED: '',
      NODE_ENV: 'development',
    };
    const config = parseAppConfig(env);
    expect(config.LOCAL_AUTH_ENABLED).toBe(true);
    expect(config.OIDC_ENABLED).toBe(false);
  });

  it('parst die LOCAL_ADMIN_*-Variablen', () => {
    const env = {
      ...baseEnv,
      LOCAL_ADMIN_EMAIL: 'admin@local.test',
      LOCAL_ADMIN_PASSWORD: 'super-secret',
      LOCAL_ADMIN_FIRST_NAME: 'Local',
      LOCAL_ADMIN_LAST_NAME: 'Admin',
    };
    const config = parseAppConfig(env);
    expect(config.LOCAL_ADMIN_EMAIL).toBe('admin@local.test');
    expect(config.LOCAL_ADMIN_PASSWORD).toBe('super-secret');
    expect(config.LOCAL_ADMIN_FIRST_NAME).toBe('Local');
    expect(config.LOCAL_ADMIN_LAST_NAME).toBe('Admin');
  });

  it('behandelt leere LOCAL_ADMIN-Strings wie nicht gesetzte Variablen', () => {
    const env = {
      ...baseEnv,
      LOCAL_ADMIN_EMAIL: '',
      LOCAL_ADMIN_PASSWORD: '',
      LOCAL_ADMIN_FIRST_NAME: '',
      LOCAL_ADMIN_LAST_NAME: '',
    };
    const config = parseAppConfig(env);
    expect(config.LOCAL_ADMIN_EMAIL).toBeUndefined();
    expect(config.LOCAL_ADMIN_PASSWORD).toBeUndefined();
  });

  it('wirft einen Fehler bei ungueltiger LOCAL_ADMIN_EMAIL', () => {
    const env = { ...baseEnv, LOCAL_ADMIN_EMAIL: 'keine-mail' };
    expect(() => parseAppConfig(env)).toThrow(/LOCAL_ADMIN_EMAIL/);
  });
});
