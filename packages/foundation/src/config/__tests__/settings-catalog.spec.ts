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
  it('hat eine versionierte Katalog-Version', () => {
    expect(SETTINGS_CATALOG_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('besitzt eindeutige Schluessel ohne Duplikate', () => {
    const keys = SETTINGS_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('katalogisiert jeden Schluessel des AppConfig-Schemas', () => {
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
      expect(getSettingDefinition(schemaKey), `Schema-Schluessel ${schemaKey} fehlt im Katalog`).toBeDefined();
    }
  });

  it('ordnet jeden Schluessel genau einer Kategorie zu', () => {
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
      // Secrets haben weder Default noch erlaubte Werte (kein Rate-Raten).
      expect(secret.defaultValue).toBeUndefined();
    }
  });

  it('liefert UI-konfigurierbare Schluessel ohne bootstrap-Werte', () => {
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

  it('listet Neustart-Schluessel separat auf', () => {
    const restartKeys = getRestartRequiredKeys();
    expect(restartKeys).toContain('STORAGE_ENABLED');
    expect(restartKeys).toContain('LOCAL_AUTH_MAX_ATTEMPTS');
    expect(restartKeys).toContain('LOCAL_AUTH_RATE_LIMIT_WINDOW_MS');
    // BugFix-05: OIDC-Feature-Schalter wird beim naechsten Start aktiv.
    expect(restartKeys).toContain('OIDC_ENABLED');
  });

  it('bietet fuer jeden UI-konfigurierbaren Schluessel eine Beschreibung', () => {
    for (const definition of SETTINGS_CATALOG) {
      expect(definition.description.length, `${definition.key} ohne Beschreibung`).toBeGreaterThan(20);
      if (definition.category !== 'bootstrap') {
        expect(definition.permission).toBe('ADMIN');
      }
    }
  });

  it('sichert Infrastruktur-/Bootstrap-Schluessel als nicht editierbar', () => {
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
    // BugFix-05: OIDC ist nicht mehr bootstrap (Client-Secret ist ein
    // UI-setzbares Secret, kein Infrastruktur-Secret).
    expect(bootstrap.map((d) => d.key)).not.toContain('OIDC_CLIENT_SECRET');
    expect(bootstrap.map((d) => d.key)).not.toContain('OIDC_ENABLED');
  });

  it('liefert unbekannte Schluessel als undefined', () => {
    expect(getSettingDefinition('DOES_NOT_EXIST')).toBeUndefined();
  });

  it('definiert jeden UI-konfigurierbaren Schluessel typsicher (Typ vorhanden)', () => {
    const uiEntries = SETTINGS_CATALOG.filter((d) => d.category !== 'bootstrap') as SettingDefinition[];
    for (const entry of uiEntries) {
      expect(['boolean', 'number', 'string']).toContain(entry.type);
    }
  });
});
