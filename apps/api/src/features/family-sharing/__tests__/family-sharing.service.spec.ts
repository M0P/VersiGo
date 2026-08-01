import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FamilySharingService } from '../family-sharing.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ObjectShareScopeType, ObjectSharePermission, GlobalRole, UserStatus } from '@prisma/client';
import { AuthService } from '../../identity/auth.service';

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    objectShare: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn(), findUnique: vi.fn() },
    objectShare: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

type MockDb = ReturnType<typeof createMockDb>;

describe('FamilySharingService', () => {
  let mockDb: MockDb;
  let service: FamilySharingService;
  const householdId = 'household-1';
  const userId = 'user-1';
  const targetUserId = 'user-2';
  const shareId = 'share-1';
  const user = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };
  const adminUser = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.ADMIN,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };

  beforeEach(() => {
    mockDb = createMockDb();
    service = new FamilySharingService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
    );
  });

  describe('create', () => {
    it('erstellt eine Freigabe und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1', householdId });

      // Erster Aufruf: sourceUser, Zweiter: targetUser
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' }) // source
        .mockResolvedValueOnce({ householdId, userId: targetUserId, role: 'MEMBER' }); // target

      // Keine doppelte Freigabe
      mockDb.objectShare.findFirst.mockResolvedValue(null);

      mockDb.objectShare.create.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: userId,
        targetUserId,
        scopeType: ObjectShareScopeType.INSURANCE,
        scopeRef: 'policy-1',
        permission: ObjectSharePermission.READ,
      });

      const result = await service.create(householdId, userId, {
        targetUserId,
        scopeType: ObjectShareScopeType.INSURANCE,
        scopeRef: 'policy-1',
        permission: ObjectSharePermission.READ,
      });

      expect(result.id).toBe(shareId);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'ObjectShare',
            action: 'CREATE',
          }),
        }),
      );
    });

    it('verweigert Erstellung ohne Household-Mitgliedschaft', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, {
          targetUserId,
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: 'policy-1',
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Erstellung wenn targetUser nicht im Household', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce(null);

      await expect(
        service.create(householdId, userId, {
          targetUserId,
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: 'policy-1',
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert Freigabe an sich selbst', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' });

      await expect(
        service.create(householdId, userId, {
          targetUserId: userId,
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: 'policy-1',
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert ALL_OWNED mit scopeRef', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce({ householdId, userId: targetUserId, role: 'MEMBER' });

      await expect(
        service.create(householdId, userId, {
          targetUserId,
          scopeType: ObjectShareScopeType.ALL_OWNED,
          scopeRef: 'policy-1',
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert INSURANCE ohne scopeRef', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce({ householdId, userId: targetUserId, role: 'MEMBER' });

      await expect(
        service.create(householdId, userId, {
          targetUserId,
          scopeType: ObjectShareScopeType.INSURANCE,
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert wenn Policy nicht existiert', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce({ householdId, userId: targetUserId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, {
          targetUserId,
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: 'nonexistent-policy',
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('verweigert doppelte Freigabe', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce({ householdId, userId: targetUserId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1', householdId });
      mockDb.objectShare.findFirst.mockResolvedValue({ id: 'existing', targetUserId });

      await expect(
        service.create(householdId, userId, {
          targetUserId,
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: 'policy-1',
          permission: ObjectSharePermission.READ,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('gibt alle Freigaben des Households zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findMany.mockResolvedValue([
        { id: 's1', householdId, sourceUserId: userId, targetUserId: 'user-3' },
        { id: 's2', householdId, sourceUserId: 'user-3', targetUserId: userId },
      ]);

      const result = await service.findAll(householdId, user);

      expect(result).toHaveLength(2);
      expect(mockDb.objectShare.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { householdId } }),
      );
    });
  });

  describe('findIncoming', () => {
    it('gibt eingehende Freigaben zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findMany.mockResolvedValue([
        { id: 's1', sourceUserId: 'user-3', targetUserId: userId },
      ]);

      const result = await service.findIncoming(householdId, userId);

      expect(result).toHaveLength(1);
      expect(mockDb.objectShare.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, targetUserId: userId },
        }),
      );
    });
  });

  describe('findOutgoing', () => {
    it('gibt ausgehende Freigaben zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findMany.mockResolvedValue([
        { id: 's1', sourceUserId: userId, targetUserId: 'user-3' },
      ]);

      const result = await service.findOutgoing(householdId, userId);

      expect(result).toHaveLength(1);
      expect(mockDb.objectShare.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, sourceUserId: userId },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('gibt eine einzelne Freigabe zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findFirst.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: userId,
        targetUserId: 'user-3',
      });

      const result = await service.findOne(householdId, user, shareId);

      expect(result.id).toBe(shareId);
    });

    it('wirft NotFoundException bei fehlender Freigabe', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, user, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('aktualisiert eine Freigabe und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findFirst.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: userId,
        targetUserId,
        permission: ObjectSharePermission.READ,
      });
      mockDb.objectShare.update.mockResolvedValue({
        id: shareId,
        permission: ObjectSharePermission.WRITE,
      });

      const result = await service.update(householdId, userId, shareId, {
        permission: ObjectSharePermission.WRITE,
      });

      expect(result.permission).toBe(ObjectSharePermission.WRITE);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'ObjectShare',
            action: 'UPDATE',
          }),
        }),
      );
    });

    it('verweigert Aktualisierung durch Nicht-Eigentuemer', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findFirst.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: 'other-user',
        targetUserId,
      });

      await expect(
        service.update(householdId, userId, shareId, {
          permission: ObjectSharePermission.WRITE,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('wirft NotFoundException bei fehlender Freigabe', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findFirst.mockResolvedValue(null);

      await expect(
        service.update(householdId, userId, 'nonexistent', {
          permission: ObjectSharePermission.WRITE,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('entzieht eine Freigabe und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce({ householdId, userId, role: 'OWNER' });
      mockDb.objectShare.findFirst.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: userId,
        targetUserId,
        scopeType: ObjectShareScopeType.INSURANCE,
        scopeRef: 'policy-1',
        permission: ObjectSharePermission.READ,
      });
      mockDb.objectShare.delete.mockResolvedValue({ id: shareId });

      const result = await service.remove(householdId, user, shareId);

      expect(result.success).toBe(true);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'ObjectShare',
            action: 'DELETE',
          }),
        }),
      );
    });

    it('erlaubt globalem ADMIN das Loeschen fremder Freigaben', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'MEMBER' })
        .mockResolvedValueOnce({ householdId, userId, role: 'OWNER' });
      mockDb.objectShare.findFirst.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: 'other-user',
        targetUserId,
      });
      mockDb.objectShare.delete.mockResolvedValue({ id: shareId });

      const result = await service.remove(householdId, adminUser, shareId);

      expect(result.success).toBe(true);
    });

    it('verweigert Entzug durch Nicht-Berechtigte', async () => {
      mockDb.householdMembership.findUnique
        .mockResolvedValueOnce({ householdId, userId, role: 'VIEWER' })
        .mockResolvedValueOnce({ householdId, userId, role: 'VIEWER' });
      mockDb.objectShare.findFirst.mockResolvedValue({
        id: shareId,
        householdId,
        sourceUserId: 'other-user',
        targetUserId,
      });

      await expect(
        service.remove(householdId, user, shareId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('wirft NotFoundException bei fehlender Freigabe', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.objectShare.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(householdId, user, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkPermission', () => {
    const ownerUserId = 'owner-1';
    const otherUserId = 'viewer-1';
    const policyId = 'policy-1';

    it('erlaubt Zugriff fuer den Owner', async () => {
      const result = await service.checkPermission(
        householdId, ownerUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(true);
      expect(mockDb.objectShare.findMany).not.toHaveBeenCalled();
    });

    it('erlaubt Zugriff bei ALL_OWNED Freigabe', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([
        {
          id: 's1',
          scopeType: ObjectShareScopeType.ALL_OWNED,
          scopeRef: null,
        },
      ]);

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(true);
    });

    it('erlaubt Zugriff bei konkreter INSURANCE Freigabe', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([
        {
          id: 's1',
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: policyId,
        },
      ]);

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(true);
    });

    it('verweigert Zugriff ohne Freigabe', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([]);

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(false);
    });

    it('verweigert Zugriff bei falscher Permission', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([]);

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.WRITE,
      );

      expect(result).toBe(false);
    });

    it('verweigert Zugriff bei falscher scopeRef', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([
        {
          id: 's1',
          scopeType: ObjectShareScopeType.INSURANCE,
          scopeRef: 'different-policy',
        },
      ]);

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(false);
    });

    it('erlaubt Zugriff bei CATEGORY Freigabe auf passende Insurance', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([
        {
          id: 's1',
          scopeType: ObjectShareScopeType.CATEGORY,
          scopeRef: 'HAFTPFLICHT',
        },
      ]);
      mockDb.insurancePolicy.findUnique.mockResolvedValue({ id: policyId, type: 'HAFTPFLICHT' });

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(true);
    });

    it('verweigert Zugriff bei CATEGORY Freigabe auf nicht passende Insurance', async () => {
      mockDb.objectShare.findMany.mockResolvedValue([
        {
          id: 's1',
          scopeType: ObjectShareScopeType.CATEGORY,
          scopeRef: 'HAFTPFLICHT',
        },
      ]);
      mockDb.insurancePolicy.findUnique.mockResolvedValue({ id: policyId, type: 'HAUSRAT' });

      const result = await service.checkPermission(
        householdId, otherUserId, ownerUserId,
        ObjectShareScopeType.INSURANCE, policyId, ObjectSharePermission.READ,
      );

      expect(result).toBe(false);
    });
  });
});
