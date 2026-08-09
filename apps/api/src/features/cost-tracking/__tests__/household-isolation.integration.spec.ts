import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostTrackingService } from '../cost-tracking.service';
import { ForbiddenException } from '@nestjs/common';
import { PaymentFrequency, GlobalRole, UserStatus } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../../identity/auth.service';

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    policyCostEntry: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn(), findMany: vi.fn() },
    policyCostEntry: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
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

describe('Cost-Tracking Household-Isolation (Integration)', () => {
  const householdA = 'household-aaaa';
  const householdB = 'household-bbbb';
  const policyInA = 'policy-in-a';
  const policyInB = 'policy-in-b';
  const userA = { id: 'user-aaaa' };
  const userB = { id: 'user-bbbb' };
  const userBUser: AuthenticatedUser = {
    id: userB.id,
    username: 'user-bbbb',
    displayName: 'User B',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [],
  };

  let mockDb: ReturnType<typeof createMockDb>;
  let service: CostTrackingService;

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
    service = new CostTrackingService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
    );
  });

  it('user A creates a CostEntry in household A (allowed)', async () => {
    setupMemberships([{ userId: userA.id, householdId: householdA, role: 'OWNER' }]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyInA, householdId: householdA });
    mockDb.policyCostEntry.create.mockResolvedValue({
      id: 'ce-1', policyId: policyInA, grossAmount: 100, frequency: 'MONTHLY',
    });

    const result = await service.create(householdA, userA.id, policyInA, {
      validFrom: '2025-01-01',
      grossAmount: 100,
      frequency: PaymentFrequency.MONTHLY,
    });

    expect(result.id).toBe('ce-1');
  });

  it('user A cannot create a CostEntry in household B (isolation)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'OWNER' },
    ]);

    await expect(
      service.create(householdB, userA.id, policyInB, {
        validFrom: '2025-01-01',
        grossAmount: 100,
        frequency: PaymentFrequency.MONTHLY,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot see CostEntries in household A (isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findAll(householdA, userBUser, policyInA),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot see a single CostEntry in household A (isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findOne(householdA, userBUser, policyInA, 'ce-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot update a CostEntry in household A (isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.update(householdA, userB.id, policyInA, 'ce-1', { grossAmount: 999 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot delete a CostEntry in household A (isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.remove(householdA, userB.id, policyInA, 'ce-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot fetch a schedule in household A (isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.getSchedule(householdA, userBUser, policyInA),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot fetch a household summary in household A (isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.getHouseholdSummary(householdA, userBUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('user B cannot read policy entries in household A (isolation, findAll)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findAll(householdA, userBUser, policyInA),
    ).rejects.toThrow(ForbiddenException);
  });
});
