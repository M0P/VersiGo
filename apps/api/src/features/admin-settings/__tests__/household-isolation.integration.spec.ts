/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

/**
 * Integrationstests fuer Household-Isolation der Admin-Settings.
 * Prueft, dass ein Household nicht auf Settings oder Flags eines
 * anderen Households zugreifen kann.
 *
 * Diese Tests arbeiten mit einem gemockten DatabaseService, der die
 * Isolation auf Datenbankebene (WHERE-Klausel mit householdId) simuliert.
 */

const mockHousehold1Settings = [
  { id: 'hs-1', householdId: 'household-1', key: 'h1-key', valuePlain: 'h1-value', isSecret: false, valueEncrypted: null, createdAt: new Date(), updatedAt: new Date() },
];

const mockHousehold2Settings: typeof mockHousehold1Settings = [];

function createIsolatedMockDb() {
  // Simuliere Datenbank-Isolation: jedes Household sieht nur eigene Daten
  const allSettings: Map<string, typeof mockHousehold1Settings> = new Map();
  allSettings.set('household-1', [...mockHousehold1Settings]);
  allSettings.set('household-2', [...mockHousehold2Settings]);

  const allFlags: Map<string, any[]> = new Map();
  allFlags.set('household-1', [{ id: 'hf-1', householdId: 'household-1', key: 'h1-flag', enabled: true, createdAt: new Date(), updatedAt: new Date() }]);
  allFlags.set('household-2', []);

  return {
    householdIntegrationSetting: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { householdId: string } }) => {
        return Promise.resolve(allSettings.get(where.householdId) ?? []);
      }),
      findUnique: vi.fn().mockImplementation(
        ({ where }: { where: { householdId_key: { householdId: string; key: string } } }) => {
          const settings = allSettings.get(where.householdId_key.householdId) ?? [];
          return Promise.resolve(
            settings.find((s) => s.key === where.householdId_key.key) ?? null,
          );
        },
      ),
      create: vi.fn().mockImplementation(({ data }: { data: { householdId: string; key: string; valuePlain?: string; isSecret?: boolean } }) => {
        const settings = allSettings.get(data.householdId) ?? [];
        const newSetting = {
          id: `hs-${Date.now()}`,
          ...data,
          isSecret: data.isSecret ?? false,
          valueEncrypted: null,
          valuePlain: data.valuePlain ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        settings.push(newSetting as any);
        return Promise.resolve(newSetting);
      }),
      delete: vi.fn().mockImplementation(
        ({ where }: { where: { householdId_key: { householdId: string; key: string } } }) => {
          const settings = allSettings.get(where.householdId_key.householdId) ?? [];
          const idx = settings.findIndex((s) => s.key === where.householdId_key.key);
          if (idx === -1) return Promise.resolve(null);
          settings.splice(idx, 1);
          return Promise.resolve({});
        },
      ),
    },
    householdFeatureFlag: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { householdId: string } }) => {
        return Promise.resolve(allFlags.get(where.householdId) ?? []);
      }),
      findUnique: vi.fn().mockImplementation(
        ({ where }: { where: { householdId_key: { householdId: string; key: string } } }) => {
          const flags = allFlags.get(where.householdId_key.householdId) ?? [];
          return Promise.resolve(
            flags.find((f) => f.key === where.householdId_key.key) ?? null,
          );
        },
      ),
      create: vi.fn().mockImplementation(({ data }: { data: { householdId: string; key: string; enabled?: boolean } }) => {
        const flags = allFlags.get(data.householdId) ?? [];
        const newFlag = {
          id: `hf-${Date.now()}`,
          ...data,
          enabled: data.enabled ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        flags.push(newFlag);
        return Promise.resolve(newFlag);
      }),
      delete: vi.fn().mockImplementation(
        ({ where }: { where: { householdId_key: { householdId: string; key: string } } }) => {
          const flags = allFlags.get(where.householdId_key.householdId) ?? [];
          const idx = flags.findIndex((f) => f.key === where.householdId_key.key);
          if (idx === -1) return Promise.resolve(null);
          flags.splice(idx, 1);
          return Promise.resolve({});
        },
      ),
    },
    globalIntegrationSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    globalFeatureFlag: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

function createMockEncryption() {
  return {
    encrypt: vi.fn().mockImplementation((plain: string) => Promise.resolve(`enc:${plain}`)),
    decrypt: vi.fn().mockImplementation((cipher: string) => Promise.resolve(cipher.replace('enc:', ''))),
  };
}

describe('Household Isolation – Admin Settings', () => {
  it('Household-1 sieht nur eigene Settings, nicht die von Household-2', async () => {
    const { SettingsStoreService } = await import('../settings-store.service');
    const mockDb = createIsolatedMockDb();
    const mockEncryption = createMockEncryption();
    const service = new SettingsStoreService(mockDb as any, mockEncryption as any);

    const h1Settings = await service.listHouseholdSettings('household-1');
    expect(h1Settings).toHaveLength(1);
    expect(h1Settings[0].key).toBe('h1-key');

    const h2Settings = await service.listHouseholdSettings('household-2');
    expect(h2Settings).toHaveLength(0);
  });

  it('Household-1 kann nicht auf Setting von Household-2 zugreifen', async () => {
    const { SettingsStoreService } = await import('../settings-store.service');
    const mockDb = createIsolatedMockDb();
    const mockEncryption = createMockEncryption();
    const service = new SettingsStoreService(mockDb as any, mockEncryption as any);

    await expect(
      service.getHouseholdSetting('household-2', 'h1-key'),
    ).rejects.toThrow(NotFoundException);
  });

  it('Household-1 sieht nur eigene Flags, nicht die von Household-2', async () => {
    const { FeatureFlagsService } = await import('../feature-flags.service');
    const mockDb = createIsolatedMockDb();
    const service = new FeatureFlagsService(mockDb as any);

    const h1Flags = await service.listHouseholdFlags('household-1');
    expect(h1Flags).toHaveLength(1);

    const h2Flags = await service.listHouseholdFlags('household-2');
    expect(h2Flags).toHaveLength(0);
  });

  it('deleteHouseholdSetting in Household-2 loescht nicht in Household-1', async () => {
    const { SettingsStoreService } = await import('../settings-store.service');
    const mockDb = createIsolatedMockDb();
    const mockEncryption = createMockEncryption();
    const service = new SettingsStoreService(mockDb as any, mockEncryption as any);

    // Loeschen eines nicht existierenden Settings in Household-2
    await expect(
      service.deleteHouseholdSetting('household-2', 'h1-key'),
    ).rejects.toThrow(NotFoundException);

    // Household-1 sollte sein Setting noch haben
    const h1Settings = await service.listHouseholdSettings('household-1');
    expect(h1Settings).toHaveLength(1);
  });
});
