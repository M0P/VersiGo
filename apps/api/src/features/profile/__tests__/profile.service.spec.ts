/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { ProfileService } from '../profile.service';

const MOCK_USER = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  locale: 'en',
  role: GlobalRole.USER,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
};

function createMockDb() {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(MOCK_USER),
      update: vi.fn().mockImplementation(({ data }: { data: any }) =>
        Promise.resolve({ ...MOCK_USER, ...data }),
      ),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function createService() {
  const db = createMockDb();
  const service = new ProfileService(db as never);
  return { db, service };
}

describe('ProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProfile', () => {
    it('returns the own profile', async () => {
      const { service } = createService();
      const profile = await service.getProfile('user-1');

      expect(profile.id).toBe('user-1');
      expect(profile.displayName).toBe('Alice');
      expect(profile.locale).toBe('en');
      expect(profile.role).toBe(GlobalRole.USER);
    });

    it('throws NotFoundException for an unknown user', async () => {
      const { db, service } = createService();
      db.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nobody')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('only changes the passed fields and only audits field names', async () => {
      const { db, service } = createService();

      const profile = await service.updateProfile('user-1', { displayName: ' Alice B. ' });

      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { displayName: 'Alice B.' },
        }),
      );
      expect(profile.displayName).toBe('Alice B.');
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PROFILE_UPDATED',
            diffJson: { fields: ['displayName'] },
          }),
        }),
      );
    });

    it('changes locale together with displayName', async () => {
      const { db, service } = createService();

      await service.updateProfile('user-1', { displayName: 'Alice', locale: 'de' });

      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { displayName: 'Alice', locale: 'de' },
        }),
      );
    });

    it('does not audit when nothing changes', async () => {
      const { db, service } = createService();

      await service.updateProfile('user-1', {});

      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.auditEvent.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown user', async () => {
      const { db, service } = createService();
      db.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('nobody', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
