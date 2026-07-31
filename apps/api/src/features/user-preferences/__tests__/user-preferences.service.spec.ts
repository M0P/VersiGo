/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserPreferencesService } from '../user-preferences.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockPreferences = [
  {
    id: 'up-1',
    userId: 'user-1',
    key: 'ui:accentColour',
    value: '#1a73e8',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

function createMockDb() {
  return {
    userPreference: {
      findUnique: vi.fn().mockImplementation(
        ({ where }: { where: { userId_key: { userId: string; key: string } } }) => {
          const match = mockPreferences.find(
            (p) => p.userId === where.userId_key.userId && p.key === where.userId_key.key,
          );
          return Promise.resolve(match ?? null);
        },
      ),
      upsert: vi.fn().mockImplementation(
        ({ create, update }: { create: any; update: any }) => {
          const existing = mockPreferences.find(
            (p) => p.userId === create.userId && p.key === create.key,
          );
          if (existing) {
            const updated = { ...existing, value: update.value, updatedAt: new Date() };
            return Promise.resolve(updated);
          }
          const created = {
            id: 'up-new',
            userId: create.userId,
            key: create.key,
            value: create.value,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return Promise.resolve(created);
        },
      ),
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        return Promise.resolve(
          mockPreferences.filter((p) => p.userId === where.userId),
        );
      }),
    },
  };
}

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new UserPreferencesService(mockDb as any);
  });

  describe('getPreference', () => {
    it('should return a preference when it exists', async () => {
      const result = await service.getPreference('user-1', 'ui:accentColour');
      expect(result.key).toBe('ui:accentColour');
      expect(result.value).toBe('#1a73e8');
    });

    it('should throw NotFoundException when preference does not exist', async () => {
      await expect(
        service.getPreference('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setPreference', () => {
    it('should create a new preference', async () => {
      const result = await service.setPreference('user-2', 'ui:accentColour', '#ff6600');
      expect(result.key).toBe('ui:accentColour');
      expect(result.value).toBe('#ff6600');
    });

    it('should update an existing preference', async () => {
      const result = await service.setPreference('user-1', 'ui:accentColour', '#ff0000');
      expect(result.key).toBe('ui:accentColour');
      expect(result.value).toBe('#ff0000');
    });

    it('should accept 3-digit hex values for the accent colour', async () => {
      const result = await service.setPreference('user-1', 'ui:accentColour', '#f60');
      expect(result.value).toBe('#f60');
    });

    it('should accept hex values without a leading #', async () => {
      const result = await service.setPreference('user-1', 'ui:accentColour', '1a73e8');
      expect(result.value).toBe('1a73e8');
    });

    it('should reject non-hex values for the accent colour', async () => {
      await expect(
        service.setPreference('user-1', 'ui:accentColour', '<script>alert(1)</script>'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setPreference('user-1', 'ui:accentColour', '../../etc/passwd'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow arbitrary values for non-UI preference keys', async () => {
      const result = await service.setPreference('user-1', 'custom:note', 'any value');
      expect(result.value).toBe('any value');
    });
  });

  describe('listPreferences', () => {
    it('should list all preferences for a user', async () => {
      const result = await service.listPreferences('user-1');
      expect(result.length).toBe(1);
      expect(result[0].key).toBe('ui:accentColour');
    });

    it('should return empty array for a user with no preferences', async () => {
      const result = await service.listPreferences('user-99');
      expect(result).toEqual([]);
    });
  });
});
