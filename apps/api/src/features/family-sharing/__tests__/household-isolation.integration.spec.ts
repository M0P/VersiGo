import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FamilySharingService } from '../family-sharing.service';
import { ForbiddenException } from '@nestjs/common';
import { ObjectShareScopeType, ObjectSharePermission, GlobalRole, UserStatus } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../../identity/auth.service';

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

type MembershipCheck = {
  userId: string;
  householdId: string;
  role: string;
};

describe('Family-Sharing Household-Isolation (Integration)', () => {
  const householdA = 'household-aaaa';
  const householdB = 'household-bbbb';
  const userA = { id: 'user-aaaa' };
  const userB = { id: 'user-bbbb' };
  const targetUser = { id: 'user-target' };
  const userBUser: AuthenticatedUser = {
    id: userB.id,
    username: 'user-bbbb',
    displayName: 'User B',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [],
  };

  let mockDb: ReturnType<typeof createMockDb>;
  let service: FamilySharingService;

  function setupMemberships(memberships: MembershipCheck[]) {
    mockDb.householdMembership.findUnique.mockImplementation(
      ({ where }: { where: { householdId_userId: { householdId: string; userId: string } } }) => {
        const found = memberships.find(
          (m) => m.householdId === where.householdId_userId.householdId && m.userId === where.householdId_userId.userId,
        );
        return Promise.resolve(found ?? null);
      },
    );
  }

  beforeEach(() => {
    mockDb = createMockDb();
    service = new FamilySharingService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
    );
  });

  it('User A erstellt Freigabe in Household A (erlaubt)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'MEMBER' },
      { userId: targetUser.id, householdId: householdA, role: 'MEMBER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1', householdId: householdA });
    mockDb.objectShare.findFirst.mockResolvedValue(null);
    mockDb.objectShare.create.mockResolvedValue({
      id: 'share-1',
      sourceUserId: userA.id,
      targetUserId: targetUser.id,
      scopeType: ObjectShareScopeType.INSURANCE,
      scopeRef: 'policy-1',
      permission: ObjectSharePermission.READ,
    });

    const result = await service.create(householdA, userA.id, {
      targetUserId: targetUser.id,
      scopeType: ObjectShareScopeType.INSURANCE,
      scopeRef: 'policy-1',
      permission: ObjectSharePermission.READ,
    });

    expect(result.id).toBe('share-1');
  });

  it('User A kann keine Freigabe in Household B erstellen (Isolation)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'OWNER' },
    ]);

    await expect(
      service.create(householdB, userA.id, {
        targetUserId: targetUser.id,
        scopeType: ObjectShareScopeType.ALL_OWNED,
        permission: ObjectSharePermission.READ,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine Freigaben in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.findAll(householdA, userBUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine eingehenden Freigaben in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.findIncoming(householdA, userB.id),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine ausgehenden Freigaben in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.findOutgoing(householdA, userB.id),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine einzelne Freigabe in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.findOne(householdA, userBUser, 'share-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine Freigabe in Household A aktualisieren (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.update(householdA, userB.id, 'share-1', {
        permission: ObjectSharePermission.WRITE,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine Freigabe in Household A entziehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.remove(householdA, userBUser, 'share-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User A kann ALL_OWNED Freigabe erstellen (ohne scopeRef)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'MEMBER' },
      { userId: targetUser.id, householdId: householdA, role: 'MEMBER' },
    ]);
    mockDb.objectShare.findFirst.mockResolvedValue(null);
    mockDb.objectShare.create.mockResolvedValue({
      id: 'share-2',
      sourceUserId: userA.id,
      targetUserId: targetUser.id,
      scopeType: ObjectShareScopeType.ALL_OWNED,
      scopeRef: null,
      permission: ObjectSharePermission.READ,
    });

    const result = await service.create(householdA, userA.id, {
      targetUserId: targetUser.id,
      scopeType: ObjectShareScopeType.ALL_OWNED,
      permission: ObjectSharePermission.READ,
    });

    expect(result.id).toBe('share-2');
  });

  it('stellt sicher, dass checkPermission ohne Household-Mitgliedschaft nicht aufgerufen wird (Owner-Check)', async () => {
    // checkPermission braucht keine Household-Prüfung, da es intern nur Shares checkt
    const result = await service.checkPermission(
      householdA, userA.id, userA.id,
      ObjectShareScopeType.INSURANCE, 'policy-1', ObjectSharePermission.READ,
    );

    expect(result).toBe(true);
  });

  it('checkPermission verweigert fremden User ohne Freigabe', async () => {
    mockDb.objectShare.findMany.mockResolvedValue([]);

    const result = await service.checkPermission(
      householdA, userB.id, userA.id,
      ObjectShareScopeType.INSURANCE, 'policy-1', ObjectSharePermission.READ,
    );

    expect(result).toBe(false);
  });
});
