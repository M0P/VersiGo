import { describe, expect, it } from 'vitest';
import { parseAppConfig } from '../app-config.schema';

const validKey = 'a'.repeat(64);

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/versigo',
  REDIS_URL: 'redis://localhost:6379',
  SETTINGS_ENCRYPTION_KEY: validKey,
  SESSION_SECRET: 'a'.repeat(32),
};

describe('parseAppConfig', () => {
  it('accepts a minimally valid configuration', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.DATABASE_URL).toBe(baseEnv.DATABASE_URL);
    expect(config.OIDC_ENABLED).toBe(false);
    expect(config.AI_ENABLED).toBe(false);
  });

  it('throws an error when DATABASE_URL is missing', () => {
    const env = { ...baseEnv, DATABASE_URL: undefined };
    expect(() => parseAppConfig(env as Record<string, string | undefined>)).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws an error for an invalid SETTINGS_ENCRYPTION_KEY', () => {
    const env = { ...baseEnv, SETTINGS_ENCRYPTION_KEY: 'zu-kurz' };
    expect(() => parseAppConfig(env)).toThrow(/SETTINGS_ENCRYPTION_KEY/);
  });

  it('parst boolesche Feature-Flags aus String-Env-Variablen', () => {
    const env = { ...baseEnv, OIDC_ENABLED: 'true', AI_ENABLED: 'false' };
    const config = parseAppConfig(env);
    expect(config.OIDC_ENABLED).toBe(true);
    expect(config.AI_ENABLED).toBe(false);
  });

  it('sets the NODE_ENV default to development', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws an error for an invalid boolean string instead of silently setting false', () => {
    const env = { ...baseEnv, AI_ENABLED: 'flase' };
    expect(() => parseAppConfig(env)).toThrow(/AI_ENABLED/);
  });

  it('accepts boolean strings case-insensitively', () => {
    const env = { ...baseEnv, AI_ENABLED: 'TRUE' };
    const config = parseAppConfig(env);
    expect(config.AI_ENABLED).toBe(true);
  });

  it('sets LOCAL_AUTH_ENABLED to true in dev mode when unset', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'development' });
    expect(config.LOCAL_AUTH_ENABLED).toBe(true);
  });

  it('sets LOCAL_AUTH_ENABLED to true in test mode when unset', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'test' });
    expect(config.LOCAL_AUTH_ENABLED).toBe(true);
  });

  it('keeps LOCAL_AUTH_ENABLED disabled in production when unset', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'production' });
    expect(config.LOCAL_AUTH_ENABLED).toBe(false);
  });

  it('gives an explicitly set LOCAL_AUTH_ENABLED variable precedence', () => {
    const env = { ...baseEnv, NODE_ENV: 'development', LOCAL_AUTH_ENABLED: 'false' };
    const config = parseAppConfig(env);
    expect(config.LOCAL_AUTH_ENABLED).toBe(false);
  });

  it('sets OIDC_ENABLED to false when unset', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.OIDC_ENABLED).toBe(false);
  });

  it('gives an explicitly set OIDC_ENABLED variable precedence', () => {
    const env = { ...baseEnv, OIDC_ENABLED: 'true' };
    const config = parseAppConfig(env);
    expect(config.OIDC_ENABLED).toBe(true);
  });

  it('treats empty auth flag strings like unset variables', () => {
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

  it('treats empty LOCAL_ADMIN strings like unset variables', () => {
    const env = {
      ...baseEnv,
      LOCAL_ADMIN_USERNAME: '',
      LOCAL_ADMIN_PASSWORD: '',
    };
    const config = parseAppConfig(env);
    expect(config.LOCAL_ADMIN_USERNAME).toBeUndefined();
    expect(config.LOCAL_ADMIN_PASSWORD).toBeUndefined();
  });

  it('throws an error for an invalid LOCAL_ADMIN_USERNAME', () => {
    const env = { ...baseEnv, LOCAL_ADMIN_USERNAME: 'kein-@-zeichen' };
    expect(() => parseAppConfig(env)).toThrow(/LOCAL_ADMIN_USERNAME/);
  });

  it('sets TRUST_PROXY to false when unset', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('gives an explicitly set TRUST_PROXY variable precedence', () => {
    const env = { ...baseEnv, TRUST_PROXY: 'true' };
    const config = parseAppConfig(env);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it('treats empty TRUST_PROXY strings like unset variables', () => {
    const config = parseAppConfig({ ...baseEnv, TRUST_PROXY: '' });
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('sets COOKIE_SECURE to true in production when unset', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'production' });
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('sets COOKIE_SECURE to false outside production when unset', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'development' });
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('gives an explicitly set COOKIE_SECURE variable precedence', () => {
    const env = { ...baseEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' };
    const config = parseAppConfig(env);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('treats empty COOKIE_SECURE strings like unset variables', () => {
    const config = parseAppConfig({ ...baseEnv, NODE_ENV: 'production', COOKIE_SECURE: '' });
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('sets CORS_ORIGINS to the web default when unset', () => {
    const config = parseAppConfig(baseEnv);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('parst CORS_ORIGINS als Komma-separierte Liste und trimmt Eintraege', () => {
    const config = parseAppConfig({
      ...baseEnv,
      CORS_ORIGINS: ' http://localhost:3000 , https://versigo.example.com ',
    });
    expect(config.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://versigo.example.com',
    ]);
  });

  it('falls back to the web default for empty CORS_ORIGINS', () => {
    const config = parseAppConfig({ ...baseEnv, CORS_ORIGINS: '' });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });
});
