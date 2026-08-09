/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

/**
 * Integration tests for household isolation of the admin settings.
 * Verifies that one household cannot access the settings of another
 * household.
 *
 * These tests work with a mocked DatabaseService that simulates the
 * isolation at the database level (WHERE clause with householdId).
 */

const mockHousehold1Settings = [
  { id: 'hs-1', householdId: 'household-1', key: 'h1-key', valuePlain: 'h1-value', isSecret: false, valueEncrypted: null, createdAt: new Date(), updatedAt: new Date() },
];

const mockHousehold2Settings: typeof mockHousehold1Settings = [];

function createIsolatedMockDb() {
  // Simulates database isolation: each household sees only its own data
  const allSettings: Map<string, typeof mockHousehold1Settings> = new Map();
  allSettings.set('household-1', [...mockHousehold1Settings]);
  allSettings.set('household-2', [...mockHousehold2Settings]);

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
    globalIntegrationSetting: {
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
  it('household 1 only sees its own settings, not those of household 2', async () => {
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

  it('household 1 cannot access a setting of household 2', async () => {
    const { SettingsStoreService } = await import('../settings-store.service');
    const mockDb = createIsolatedMockDb();
    const mockEncryption = createMockEncryption();
    const service = new SettingsStoreService(mockDb as any, mockEncryption as any);

    await expect(
      service.getHouseholdSetting('household-2', 'h1-key'),
    ).rejects.toThrow(NotFoundException);
  });

  it('deleteHouseholdSetting in household 2 does not delete in household 1', async () => {
    const { SettingsStoreService } = await import('../settings-store.service');
    const mockDb = createIsolatedMockDb();
    const mockEncryption = createMockEncryption();
    const service = new SettingsStoreService(mockDb as any, mockEncryption as any);

    // Deleting a non-existent setting in household 2
    await expect(
      service.deleteHouseholdSetting('household-2', 'h1-key'),
    ).rejects.toThrow(NotFoundException);

    // Household 1 should still have its setting
    const h1Settings = await service.listHouseholdSettings('household-1');
    expect(h1Settings).toHaveLength(1);
  });
});
