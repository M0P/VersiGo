/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeatureFlagsService } from '../feature-flags.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const mockGlobalFlags = [
  { id: 'gf-1', key: 'feature-a', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  { id: 'gf-2', key: 'feature-b', enabled: false, createdAt: new Date(), updatedAt: new Date() },
];

const mockHouseholdFlags = [
  { id: 'hf-1', householdId: 'household-1', key: 'hf-a', enabled: true, createdAt: new Date(), updatedAt: new Date() },
];

function createMockDb() {
  return {
    globalFeatureFlag: {
      findMany: vi.fn().mockResolvedValue(mockGlobalFlags),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { key: string } }) => {
        return Promise.resolve(
          mockGlobalFlags.find((f) => f.key === where.key) ?? null,
        );
      }),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        return Promise.resolve({
          id: 'gf-new',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { key: string }; data: any }) => {
        const existing = mockGlobalFlags.find((f) => f.key === where.key);
        if (!existing) return Promise.resolve(null);
        return Promise.resolve({ ...existing, ...data, updatedAt: new Date() });
      }),
      delete: vi.fn().mockResolvedValue({}),
    },
    householdFeatureFlag: {
      findMany: vi.fn().mockResolvedValue(mockHouseholdFlags),
      findUnique: vi.fn().mockImplementation(
        ({ where }: { where: { householdId_key: { householdId: string; key: string } } }) => {
          return Promise.resolve(
            mockHouseholdFlags.find(
              (f) =>
                f.householdId === where.householdId_key.householdId &&
                f.key === where.householdId_key.key,
            ) ?? null,
          );
        },
      ),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        return Promise.resolve({
          id: 'hf-new',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      update: vi.fn().mockImplementation(
        ({ where, data }: { where: { householdId_key: { householdId: string; key: string } }; data: any }) => {
          const existing = mockHouseholdFlags.find(
            (f) =>
              f.householdId === where.householdId_key.householdId &&
              f.key === where.householdId_key.key,
          );
          if (!existing) return Promise.resolve(null);
          return Promise.resolve({ ...existing, ...data, updatedAt: new Date() });
        },
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new FeatureFlagsService(mockDb as any);
  });

  describe('Global Flags', () => {
    it('listGlobalFlags gibt alle Flags zurueck', async () => {
      const result = await service.listGlobalFlags();
      expect(result).toHaveLength(2);
    });

    it('getGlobalFlag wirft NotFoundException bei fehlendem Flag', async () => {
      await expect(service.getGlobalFlag('nicht-da')).rejects.toThrow(NotFoundException);
    });

    it('createGlobalFlag legt neues Flag an', async () => {
      const result = await service.createGlobalFlag('feature-c', true);
      expect(result.key).toBe('feature-c');
      expect(result.enabled).toBe(true);
    });

    it('createGlobalFlag wirft ConflictException bei doppeltem Key', async () => {
      const dbWithConflict = {
        ...mockDb,
        globalFeatureFlag: {
          ...mockDb.globalFeatureFlag,
          findUnique: vi.fn().mockResolvedValue(mockGlobalFlags[0]),
        },
      };
      const conflictingService = new FeatureFlagsService(dbWithConflict as any);
      await expect(
        conflictingService.createGlobalFlag('feature-a', true),
      ).rejects.toThrow(ConflictException);
    });

    it('updateGlobalFlag aendert den Status', async () => {
      const result = await service.updateGlobalFlag('feature-a', false);
      expect(result.enabled).toBe(false);
    });

    it('deleteGlobalFlag loescht Flag', async () => {
      const result = await service.deleteGlobalFlag('feature-a');
      expect(result).toEqual({ success: true });
    });

    it('isGlobalEnabled gibt false zurueck bei fehlendem Flag', async () => {
      const dbWithNull = {
        ...mockDb,
        globalFeatureFlag: {
          ...mockDb.globalFeatureFlag,
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      const serviceWithNull = new FeatureFlagsService(dbWithNull as any);
      const result = await serviceWithNull.isGlobalEnabled('nicht-da');
      expect(result).toBe(false);
    });
  });

  describe('Household Flags', () => {
    it('listHouseholdFlags gibt Flags fuer Household zurueck', async () => {
      const result = await service.listHouseholdFlags('household-1');
      expect(result).toHaveLength(1);
    });

    it('createHouseholdFlag legt neues Flag an', async () => {
      const result = await service.createHouseholdFlag('household-1', 'hf-b', true);
      expect(result.key).toBe('hf-b');
      expect(result.householdId).toBe('household-1');
    });

    it('updateHouseholdFlag aendert den Status', async () => {
      const result = await service.updateHouseholdFlag('household-1', 'hf-a', false);
      expect(result.enabled).toBe(false);
    });

    it('deleteHouseholdFlag loescht Flag', async () => {
      const result = await service.deleteHouseholdFlag('household-1', 'hf-a');
      expect(result).toEqual({ success: true });
    });

    it('isHouseholdEnabled gibt false zurueck bei fehlendem Flag', async () => {
      const result = await service.isHouseholdEnabled('household-1', 'nicht-da');
      expect(result).toBe(false);
    });
  });
});
