/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsStoreService } from '../settings-store.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

// Mock-Daten
const mockGlobalSettings = [
  {
    id: 'gs-1',
    key: 'test-key',
    valueEncrypted: null,
    valuePlain: 'test-value',
    isSecret: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'gs-2',
    key: 'secret-key',
    valueEncrypted: 'encrypted:data:here',
    valuePlain: null,
    isSecret: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

const mockHouseholdSettings = [
  {
    id: 'hs-1',
    householdId: 'household-1',
    key: 'hs-key',
    valueEncrypted: null,
    valuePlain: 'hs-value',
    isSecret: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

function createMockDb() {
  return {
    globalIntegrationSetting: {
      findMany: vi.fn().mockResolvedValue(mockGlobalSettings),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { key: string } }) => {
        return Promise.resolve(
          mockGlobalSettings.find((s) => s.key === where.key) ?? null,
        );
      }),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        const newSetting = {
          id: 'gs-new',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return Promise.resolve(newSetting);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { key: string }; data: any }) => {
        const existing = mockGlobalSettings.find((s) => s.key === where.key);
        if (!existing) return Promise.resolve(null);
        return Promise.resolve({
          ...existing,
          ...data,
          updatedAt: new Date(),
        });
      }),
      delete: vi.fn().mockResolvedValue({}),
    },
    householdIntegrationSetting: {
      findMany: vi.fn().mockResolvedValue(mockHouseholdSettings),
      findUnique: vi.fn().mockImplementation(
        ({ where }: { where: { householdId_key: { householdId: string; key: string } } }) => {
          return Promise.resolve(
            mockHouseholdSettings.find(
              (s) =>
                s.householdId === where.householdId_key.householdId &&
                s.key === where.householdId_key.key,
            ) ?? null,
          );
        },
      ),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        return Promise.resolve({
          id: 'hs-new',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      update: vi.fn().mockImplementation(
        ({ where, data }: { where: { householdId_key: { householdId: string; key: string } }; data: any }) => {
          const existing = mockHouseholdSettings.find(
            (s) =>
              s.householdId === where.householdId_key.householdId &&
              s.key === where.householdId_key.key,
          );
          if (!existing) return Promise.resolve(null);
          return Promise.resolve({
            ...existing,
            ...data,
            updatedAt: new Date(),
          });
        },
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
}

function createMockEncryption() {
  return {
    encrypt: vi.fn().mockImplementation((plain: string) =>
      Promise.resolve(`encrypted:${plain}`),
    ),
    decrypt: vi.fn().mockImplementation((cipher: string) =>
      Promise.resolve(cipher.replace('encrypted:', '')),
    ),
  };
}

describe('SettingsStoreService', () => {
  let service: SettingsStoreService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEncryption: ReturnType<typeof createMockEncryption>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEncryption = createMockEncryption();
    service = new SettingsStoreService(
      mockDb as any,
      mockEncryption as any,
    );
  });

  describe('Global Settings', () => {
    it('listGlobalSettings maskiert Secret-Werte', async () => {
      const result = await service.listGlobalSettings();
      expect(result).toHaveLength(2);
      expect(result[0].valuePlain).toBe('test-value');
      expect(result[1].valuePlain).toBe('********');
    });

    it('getGlobalSetting gibt maskierten Wert fuer Secrets zurueck', async () => {
      const result = await service.getGlobalSetting('secret-key');
      expect(result.valuePlain).toBe('********');
    });

    it('getGlobalSetting wirft NotFoundException bei fehlendem Key', async () => {
      await expect(service.getGlobalSetting('nicht-da')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('createGlobalSetting mit isSecret=true verschluesselt den Wert', async () => {
      const result = await service.createGlobalSetting(
        'new-secret',
        'geheim',
        true,
      );
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('geheim');
      expect(result.isSecret).toBe(true);
      expect(result.valuePlain).toBe('********');
    });

    it('createGlobalSetting ohne isSecret speichert im Klartext', async () => {
      const result = await service.createGlobalSetting(
        'new-plain',
        'sichtbar',
        false,
      );
      expect(mockEncryption.encrypt).not.toHaveBeenCalled();
      expect(result.valuePlain).toBe('sichtbar');
    });

    it('createGlobalSetting wirft ConflictException bei doppeltem Key', async () => {
      // Test nur, wenn der Mock den ConflictException-Fall abdeckt
      // Dafuer muessen wir den Mock anpassen
      const dbWithConflict = {
        ...mockDb,
        globalIntegrationSetting: {
          ...mockDb.globalIntegrationSetting,
          findUnique: vi.fn().mockResolvedValue(mockGlobalSettings[0]),
        },
      };
      const conflictingService = new SettingsStoreService(
        dbWithConflict as any,
        mockEncryption as any,
      );
      await expect(
        conflictingService.createGlobalSetting('test-key', 'value', false),
      ).rejects.toThrow(ConflictException);
    });

    it('updateGlobalSetting mit neuem Wert aktualisiert', async () => {
      const result = await service.updateGlobalSetting(
        'test-key',
        'neuer-wert',
        false,
      );
      expect(result.key).toBe('test-key');
    });

    it('updateGlobalSetting wirft NotFoundException bei fehlendem Key', async () => {
      await expect(
        service.updateGlobalSetting('nicht-da', 'wert', false),
      ).rejects.toThrow(NotFoundException);
    });

    it('deleteGlobalSetting loescht Einstellung', async () => {
      const result = await service.deleteGlobalSetting('test-key');
      expect(result).toEqual({ success: true });
    });

    it('deleteGlobalSetting wirft NotFoundException bei fehlendem Key', async () => {
      const dbWithNotFound = {
        ...mockDb,
        globalIntegrationSetting: {
          ...mockDb.globalIntegrationSetting,
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      const serviceWithNotFound = new SettingsStoreService(
        dbWithNotFound as any,
        mockEncryption as any,
      );
      await expect(
        serviceWithNotFound.deleteGlobalSetting('nicht-da'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Household Settings', () => {
    it('listHouseholdSettings maskiert Secret-Werte', async () => {
      const result = await service.listHouseholdSettings('household-1');
      expect(result).toHaveLength(1);
      expect(result[0].valuePlain).toBe('hs-value');
    });

    it('getHouseholdSetting wirft NotFoundException bei fehlendem Key', async () => {
      await expect(
        service.getHouseholdSetting('household-1', 'nicht-da'),
      ).rejects.toThrow(NotFoundException);
    });

    it('createHouseholdSetting mit isSecret=true verschluesselt', async () => {
      const result = await service.createHouseholdSetting(
        'household-1',
        'new-secret',
        'geheim',
        true,
      );
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('geheim');
      expect(result.isSecret).toBe(true);
    });

    it('createHouseholdSetting wirft ConflictException bei doppeltem Key', async () => {
      const dbWithConflict = {
        ...mockDb,
        householdIntegrationSetting: {
          ...mockDb.householdIntegrationSetting,
          findUnique: vi.fn().mockResolvedValue(mockHouseholdSettings[0]),
        },
      };
      const conflictingService = new SettingsStoreService(
        dbWithConflict as any,
        mockEncryption as any,
      );
      await expect(
        conflictingService.createHouseholdSetting(
          'household-1',
          'hs-key',
          'value',
          false,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('deleteHouseholdSetting loescht Einstellung', async () => {
      const result = await service.deleteHouseholdSetting(
        'household-1',
        'hs-key',
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('Decrypted Values (intern)', () => {
    it('getDecryptedGlobalValue gibt entschluesselten Wert zurueck', async () => {
      const result = await service.getDecryptedGlobalValue('secret-key');
      expect(mockEncryption.decrypt).toHaveBeenCalledWith('encrypted:data:here');
      expect(result).toBe('data:here');
    });

    it('getDecryptedGlobalValue gibt Klartext-Wert zurueck', async () => {
      const result = await service.getDecryptedGlobalValue('test-key');
      expect(result).toBe('test-value');
    });

    it('getDecryptedGlobalValue gibt null bei fehlendem Key', async () => {
      const dbWithNull = {
        ...mockDb,
        globalIntegrationSetting: {
          ...mockDb.globalIntegrationSetting,
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      const serviceWithNull = new SettingsStoreService(
        dbWithNull as any,
        mockEncryption as any,
      );
      const result = await serviceWithNull.getDecryptedGlobalValue('nicht-da');
      expect(result).toBeNull();
    });
  });
});
