/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest';
import { AdminSettingsController } from '../admin-settings.controller';
import { GlobalRole } from '@prisma/client';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity/auth.service';

// SSRF-Guard wird im Controller-Spec gemockt (eigene Guard-Spec testet die
// Blockliste); hier wird nur der Ablehnungspfad verifiziert.
const { assertSafeTestEndpoint } = vi.hoisted(() => ({
  assertSafeTestEndpoint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../common/connectivity/connectivity-guard', () => ({
  assertSafeTestEndpoint,
}));

const adminUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'admin',
  displayName: 'Admin',
  role: GlobalRole.ADMIN,
  status: 'ACTIVE' as any,
  memberships: [{ householdId: 'household-1' }],
};

const userUser: AuthenticatedUser = {
  id: 'user-2',
  username: 'member',
  displayName: 'Member',
  role: GlobalRole.USER,
  status: 'ACTIVE' as any,
  memberships: [{ householdId: 'household-1' }],
};

const readOnlyUser: AuthenticatedUser = {
  id: 'user-3',
  username: 'viewer',
  displayName: 'Viewer',
  role: GlobalRole.READ_ONLY,
  status: 'ACTIVE' as any,
  memberships: [{ householdId: 'household-1' }],
};

function createMockSettingsStore() {
  return {
    listGlobalSettings: vi.fn().mockResolvedValue([]),
    getGlobalSetting: vi.fn().mockImplementation((key: string) =>
      Promise.resolve({ key, valuePlain: 'test', isSecret: false, id: 'id', createdAt: new Date(), updatedAt: new Date() }),
    ),
    createGlobalSetting: vi.fn().mockImplementation(
      (key: string, valuePlain: string | undefined, isSecret: boolean | undefined) =>
        Promise.resolve({ key, valuePlain: valuePlain ?? '', isSecret: isSecret ?? false, id: 'id', createdAt: new Date(), updatedAt: new Date() }),
    ),
    updateGlobalSetting: vi.fn().mockImplementation(
      (key: string, valuePlain: string | undefined, isSecret: boolean | undefined) =>
        Promise.resolve({ key, valuePlain: valuePlain ?? '', isSecret: isSecret ?? false, id: 'id', createdAt: new Date(), updatedAt: new Date() }),
    ),
    deleteGlobalSetting: vi.fn().mockResolvedValue({ success: true }),
    listHouseholdSettings: vi.fn().mockResolvedValue([]),
    getHouseholdSetting: vi.fn().mockResolvedValue({}),
    createHouseholdSetting: vi.fn().mockResolvedValue({}),
    updateHouseholdSetting: vi.fn().mockResolvedValue({}),
    deleteHouseholdSetting: vi.fn().mockResolvedValue({ success: true }),
    getDecryptedGlobalValue: vi.fn().mockResolvedValue(null),
    getDecryptedHouseholdValue: vi.fn().mockResolvedValue(null),
  };
}

function createMockFeatureFlags() {
  return {
    listGlobalFlags: vi.fn().mockResolvedValue([]),
    getGlobalFlag: vi.fn().mockImplementation((key: string) =>
      Promise.resolve({ key, enabled: false, id: 'id', createdAt: new Date(), updatedAt: new Date() }),
    ),
    createGlobalFlag: vi.fn().mockImplementation(
      (key: string, enabled: boolean | undefined) =>
        Promise.resolve({ key, enabled: enabled ?? false, id: 'id', createdAt: new Date(), updatedAt: new Date() }),
    ),
    updateGlobalFlag: vi.fn().mockImplementation(
      (key: string, enabled: boolean) =>
        Promise.resolve({ key, enabled, id: 'id', createdAt: new Date(), updatedAt: new Date() }),
    ),
    deleteGlobalFlag: vi.fn().mockResolvedValue({ success: true }),
    isGlobalEnabled: vi.fn().mockResolvedValue(false),
    listHouseholdFlags: vi.fn().mockResolvedValue([]),
    getHouseholdFlag: vi.fn().mockResolvedValue({}),
    createHouseholdFlag: vi.fn().mockResolvedValue({}),
    updateHouseholdFlag: vi.fn().mockResolvedValue({}),
    deleteHouseholdFlag: vi.fn().mockResolvedValue({ success: true }),
    isHouseholdEnabled: vi.fn().mockResolvedValue(false),
  };
}

function createMockConfig() {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      const config: Record<string, any> = {
        DATABASE_URL: 'postgresql://localhost:5432/versigo',
        REDIS_URL: 'redis://localhost:6379',
        SETTINGS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
        SESSION_SECRET: 'a-very-long-secret-that-is-at-least-32-characters-long!!',
        OIDC_ENABLED: false,
        APP_PORT: 3001,
      };
      return config[key];
    }),
    get isProduction() { return false; },
  } as any;
}

function createMockDb() {
  return {
    isHealthy: vi.fn().mockResolvedValue(true),
  } as any;
}

describe('AdminSettingsController', () => {
  describe('Global Admin Guard (assertIsGlobalAdmin)', () => {
    it('erlaubt Zugriff fuer ADMIN auf globale Admin-Endpoints', async () => {
      const settingsStore = createMockSettingsStore();
      const featureFlags = createMockFeatureFlags();
      const config = createMockConfig();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, featureFlags as any, config, db);

      const result = await controller.listGlobalSettings(adminUser);
      expect(result).toEqual([]);
    });

    it('verweigert Zugriff fuer USER auf globale Admin-Endpoints', async () => {
      const settingsStore = createMockSettingsStore();
      const featureFlags = createMockFeatureFlags();
      const config = createMockConfig();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, featureFlags as any, config, db);

      await expect(controller.listGlobalSettings(userUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('verweigert Zugriff fuer READ_ONLY auf globale Admin-Endpoints', async () => {
      const settingsStore = createMockSettingsStore();
      const featureFlags = createMockFeatureFlags();
      const config = createMockConfig();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, featureFlags as any, config, db);

      await expect(controller.listGlobalSettings(readOnlyUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('erlaubt ADMIN-Rolle auf globale Admin-Endpoints', async () => {
      const adminUser2: AuthenticatedUser = {
        id: 'user-4',
        username: 'admin2',
        displayName: 'Admin 2',
        role: GlobalRole.ADMIN,
        status: 'ACTIVE' as any,
        memberships: [{ householdId: 'household-2' }],
      };
      const settingsStore = createMockSettingsStore();
      const featureFlags = createMockFeatureFlags();
      const config = createMockConfig();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, featureFlags as any, config, db);

      const result = await controller.listGlobalFlags(adminUser2);
      expect(result).toEqual([]);
    });
  });

  describe('Global Settings CRUD', () => {
    it('createGlobalSetting ruft SettingsStore mit Katalog-Schluessel und erzwungenem isSecret auf', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await controller.createGlobalSetting(adminUser, { key: 'AI_ENABLED', valuePlain: 'true', isSecret: false });
      expect(settingsStore.createGlobalSetting).toHaveBeenCalledWith('AI_ENABLED', 'true', false);
    });

    it('createGlobalSetting erzwingt isSecret=true fuer Katalog-Secrets', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await controller.createGlobalSetting(adminUser, { key: 'AI_OPENAI_COMPAT_API_KEY', valuePlain: 'sk-123', isSecret: false });
      expect(settingsStore.createGlobalSetting).toHaveBeenCalledWith('AI_OPENAI_COMPAT_API_KEY', 'sk-123', true);
    });

    it('createGlobalSetting lehnt unbekannte Schluessel ab (Allowlist)', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await expect(
        controller.createGlobalSetting(adminUser, { key: 'new-key', valuePlain: 'value', isSecret: false }),
      ).rejects.toThrow(BadRequestException);
      expect(settingsStore.createGlobalSetting).not.toHaveBeenCalled();
    });

    it('createGlobalSetting lehnt Bootstrap-Schluessel ab', async () => {
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await expect(
        controller.createGlobalSetting(adminUser, { key: 'DATABASE_URL', valuePlain: 'postgres://x', isSecret: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('createGlobalSetting lehnt ungueltige Werte ab', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await expect(
        controller.createGlobalSetting(adminUser, { key: 'AI_ENABLED', valuePlain: 'not-a-boolean', isSecret: false }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.createGlobalSetting(adminUser, { key: 'AI_ENABLED', valuePlain: '', isSecret: false }),
      ).rejects.toThrow(BadRequestException);
      expect(settingsStore.createGlobalSetting).not.toHaveBeenCalled();
    });

    it('createGlobalSetting lehnt Anlage ohne Wert ab (keine tote Zeile)', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await expect(
        controller.createGlobalSetting(adminUser, { key: 'AI_ENABLED' }),
      ).rejects.toThrow(BadRequestException);
      // m9-ext: explizites null passiert @IsOptional() und darf keinen
      // HTTP-500 in der Typvalidierung ausloesen, sondern einen sauberen 400.
      await expect(
        controller.createGlobalSetting(adminUser, { key: 'AI_ENABLED', valuePlain: null as unknown as string }),
      ).rejects.toThrow(BadRequestException);
      expect(settingsStore.createGlobalSetting).not.toHaveBeenCalled();
    });

    it('getGlobalSetting ruft SettingsStore auf', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await controller.getGlobalSetting(adminUser, 'test-key');
      expect(settingsStore.getGlobalSetting).toHaveBeenCalledWith('test-key');
    });

    it('updateGlobalSetting ruft SettingsStore mit validiertem Wert und Katalog-isSecret auf', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await controller.updateGlobalSetting(adminUser, 'AI_ENABLED', { valuePlain: 'false', isSecret: true });
      expect(settingsStore.updateGlobalSetting).toHaveBeenCalledWith('AI_ENABLED', 'false', false);
    });

    it('updateGlobalSetting lehnt unbekannte Schluessel ab (Allowlist)', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await expect(
        controller.updateGlobalSetting(adminUser, 'test-key', { valuePlain: 'new-value' }),
      ).rejects.toThrow(BadRequestException);
      expect(settingsStore.updateGlobalSetting).not.toHaveBeenCalled();
    });

    it('deleteGlobalSetting ruft SettingsStore auf', async () => {
      const settingsStore = createMockSettingsStore();
      const db = createMockDb();
      const controller = new AdminSettingsController(settingsStore as any, createMockFeatureFlags() as any, createMockConfig(), db);

      await controller.deleteGlobalSetting(adminUser, 'test-key');
      expect(settingsStore.deleteGlobalSetting).toHaveBeenCalledWith('test-key');
    });
  });

  describe('Global Feature Flags CRUD', () => {
    it('createGlobalFlag ruft FeatureFlagsService auf', async () => {
      const featureFlags = createMockFeatureFlags();
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, featureFlags as any, createMockConfig(), db);

      await controller.createGlobalFlag(adminUser, { key: 'flag-a', enabled: true });
      expect(featureFlags.createGlobalFlag).toHaveBeenCalledWith('flag-a', true);
    });

    it('updateGlobalFlag ruft FeatureFlagsService auf', async () => {
      const featureFlags = createMockFeatureFlags();
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, featureFlags as any, createMockConfig(), db);

      await controller.updateGlobalFlag(adminUser, 'flag-a', { enabled: false });
      expect(featureFlags.updateGlobalFlag).toHaveBeenCalledWith('flag-a', false);
    });
  });

  describe('Config Validation', () => {
    it('validateConfig gibt Checks zurueck', async () => {
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, createMockFeatureFlags() as any, createMockConfig(), db);

      const result = await controller.validateConfig(adminUser);
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('checks');
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
    });
  });

  describe('Connectivity Test', () => {
    it('testConnectivity mit database ruft isHealthy auf', async () => {
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, createMockFeatureFlags() as any, createMockConfig(), db);

      const result = await controller.testConnectivity(adminUser, { integrationKey: 'database' });
      expect(db.isHealthy).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('testConnectivity mit unbekanntem Key ohne Endpoint gibt Fehler', async () => {
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, createMockFeatureFlags() as any, createMockConfig(), db);

      const result = await controller.testConnectivity(adminUser, { integrationKey: 'custom' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Kein Endpoint');
    });

    it('testConnectivity mit Endpoint fragt den Dienst ab', async () => {
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, createMockFeatureFlags() as any, createMockConfig(), db);
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
      vi.stubGlobal('fetch', fetchMock);

      const result = await controller.testConnectivity(adminUser, {
        integrationKey: 'custom',
        endpoint: 'https://example.com/health',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('HTTP 200: OK');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/health',
        expect.anything(),
      );
      vi.unstubAllGlobals();
    });

    it('testConnectivity lehnt unsichere Endpunkte (SSRF) ab, ohne sie anzufragen', async () => {
      assertSafeTestEndpoint.mockRejectedValueOnce(
        new Error('Adresse liegt in einem gesperrten Bereich'),
      );
      const db = createMockDb();
      const controller = new AdminSettingsController(createMockSettingsStore() as any, createMockFeatureFlags() as any, createMockConfig(), db);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await controller.testConnectivity(adminUser, {
        integrationKey: 'custom',
        endpoint: 'http://169.254.169.254/latest/meta-data',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('abgelehnt');
      expect(result.message).toContain('gesperrten Bereich');
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
