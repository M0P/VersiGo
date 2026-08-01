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
      LOCAL_ADMIN_USERNAME: 'localadmin',
      LOCAL_ADMIN_PASSWORD: 'super-secret',
    };
    const config = parseAppConfig(env);
    expect(config.LOCAL_ADMIN_USERNAME).toBe('localadmin');
    expect(config.LOCAL_ADMIN_PASSWORD).toBe('super-secret');
  });

  it('behandelt leere LOCAL_ADMIN-Strings wie nicht gesetzte Variablen', () => {
    const env = {
      ...baseEnv,
      LOCAL_ADMIN_USERNAME: '',
      LOCAL_ADMIN_PASSWORD: '',
    };
    const config = parseAppConfig(env);
    expect(config.LOCAL_ADMIN_USERNAME).toBeUndefined();
    expect(config.LOCAL_ADMIN_PASSWORD).toBeUndefined();
  });

  it('wirft einen Fehler bei ungueltigem LOCAL_ADMIN_USERNAME', () => {
    const env = { ...baseEnv, LOCAL_ADMIN_USERNAME: 'kein-@-zeichen' };
    expect(() => parseAppConfig(env)).toThrow(/LOCAL_ADMIN_USERNAME/);
  });

  it('setzt TRUST_PROXY auf false, wenn nicht gesetzt', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('gibt einer explizit gesetzten TRUST_PROXY-Variable Vorrang', () => {
    const env = { ...baseEnv, TRUST_PROXY: 'true' };
    const config = parseAppConfig(env);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it('behandelt leere TRUST_PROXY-Strings wie nicht gesetzte Variablen', () => {
    const config = parseAppConfig({ ...baseEnv, TRUST_PROXY: '' });
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('setzt CORS_ORIGINS auf den Web-Default, wenn nicht gesetzt', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('parst CORS_ORIGINS als Komma-separierte Liste und trimmt Eintraege', () => {
    const config = parseAppConfig({
      ...baseEnv,
      CORS_ORIGINS: ' http://localhost:3000 , https://insura.example.com ',
    });
    expect(config.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://insura.example.com',
    ]);
  });

  it('faellt bei leerem CORS_ORIGINS auf den Web-Default zurueck', () => {
    const config = parseAppConfig({ ...baseEnv, CORS_ORIGINS: '' });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });
});
