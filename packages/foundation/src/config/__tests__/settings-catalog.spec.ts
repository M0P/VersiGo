import { describe, expect, it } from 'vitest';
import {
  SETTINGS_CATALOG,
  SETTINGS_CATALOG_VERSION,
  getSettingDefinition,
  getUiConfigurableKeys,
  getRestartRequiredKeys,
  isSecretKey,
} from '../settings-catalog';
import { parseAppConfig } from '../app-config.schema';
import type { SettingDefinition } from '../settings-catalog';

describe('settings-catalog', () => {
  it('has a versioned catalog version', () => {
    expect(SETTINGS_CATALOG_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('has unique keys without duplicates', () => {
    const keys = SETTINGS_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('catalogues every AppConfig schema key', () => {
    const parsedKeys = Object.keys(
      parseAppConfig({
        DATABASE_URL: 'postgresql://u:p@localhost:5432/versigo',
        REDIS_URL: 'redis://localhost:6379',
        SETTINGS_ENCRYPTION_KEY: 'a'.repeat(64),
        SESSION_SECRET: 'a'.repeat(32),
      }),
    );
    expect(parsedKeys.length).toBeGreaterThan(20);
    for (const schemaKey of parsedKeys) {
      expect(getSettingDefinition(schemaKey), `AppConfig schema key ${schemaKey} missing in catalog`).toBeDefined();
    }
  });

  it('assigns every key to exactly one category', () => {
    const validCategories = new Set(['runtime', 'restart', 'secret', 'bootstrap']);
    for (const definition of SETTINGS_CATALOG) {
      expect(validCategories.has(definition.category)).toBe(true);
    }
  });

  it('kennzeichnet Kategorie-Secrets korrekt', () => {
    const secrets = SETTINGS_CATALOG.filter((d) => d.category === 'secret');
    expect(secrets.length).toBeGreaterThanOrEqual(2);
    for (const secret of secrets) {
      expect(isSecretKey(secret.key)).toBe(true);
      // Secrets have neither a default nor allowed values (no guessing).
      expect(secret.defaultValue).toBeUndefined();
    }
  });

  it('returns UI-configurable keys without bootstrap values', () => {
    const uiKeys = getUiConfigurableKeys();
    expect(uiKeys).toContain('AI_ENABLED');
    expect(uiKeys).toContain('PAPERLESS_URL');
    expect(uiKeys).toContain('STORAGE_ENABLED');
    // BugFix-05: OIDC ist seit der Umstellung UI-konfigurierbar
    // (restart-Kategorie; das Client-Secret als Secret).
    expect(uiKeys).toContain('OIDC_ENABLED');
    expect(uiKeys).toContain('OIDC_CLIENT_SECRET');
    expect(uiKeys).not.toContain('DATABASE_URL');
    expect(uiKeys).not.toContain('SETTINGS_ENCRYPTION_KEY');
    expect(uiKeys).not.toContain('SESSION_SECRET');
  });

  it('lists restart keys separately', () => {
    const restartKeys = getRestartRequiredKeys();
    expect(restartKeys).toContain('STORAGE_ENABLED');
    expect(restartKeys).toContain('LOCAL_AUTH_MAX_ATTEMPTS');
    expect(restartKeys).toContain('LOCAL_AUTH_RATE_LIMIT_WINDOW_MS');
    // BugFix-05: the OIDC feature switch becomes active on the next start.
    expect(restartKeys).toContain('OIDC_ENABLED');
  });

  it('provides a description for every UI-configurable key', () => {
    for (const definition of SETTINGS_CATALOG) {
      expect(definition.description.length, `${definition.key} without description`).toBeGreaterThan(20);
      if (definition.category !== 'bootstrap') {
        expect(definition.permission).toBe('ADMIN');
      }
    }
  });

  it('secures infrastructure/bootstrap keys as non-editable', () => {
    const bootstrap = SETTINGS_CATALOG.filter((d) => d.category === 'bootstrap');
    expect(bootstrap.map((d) => d.key)).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'REDIS_URL',
        'SETTINGS_ENCRYPTION_KEY',
        'SESSION_SECRET',
        'LOCAL_ADMIN_PASSWORD',
        'S3_SECRET_KEY',
      ]),
    );
    // BugFix-05: OIDC is no longer bootstrap (the client secret is a
    // UI-settable secret, not an infrastructure secret).
    expect(bootstrap.map((d) => d.key)).not.toContain('OIDC_CLIENT_SECRET');
    expect(bootstrap.map((d) => d.key)).not.toContain('OIDC_ENABLED');
  });

  it('returns unknown keys as undefined', () => {
    expect(getSettingDefinition('DOES_NOT_EXIST')).toBeUndefined();
  });

  it('defines every UI-configurable key type-safe (type present)', () => {
    const uiEntries = SETTINGS_CATALOG.filter((d) => d.category !== 'bootstrap') as SettingDefinition[];
    for (const entry of uiEntries) {
      expect(['boolean', 'number', 'string']).toContain(entry.type);
    }
  });
});
