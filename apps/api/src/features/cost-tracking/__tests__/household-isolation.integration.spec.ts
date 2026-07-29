import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostTrackingService } from '../cost-tracking.service';
import { ForbiddenException } from '@nestjs/common';
import { PaymentFrequency } from '@prisma/client';

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
    service = new CostTrackingService(mockDb as never);
  });

  it('User A erstellt CostEntry in Household A (erlaubt)', async () => {
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

  it('User A kann keinen CostEntry in Household B erstellen (Isolation)', async () => {
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

  it('User B kann keine CostEntries in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findAll(householdA, userB.id, policyInA),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keinen einzelnen CostEntry in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findOne(householdA, userB.id, policyInA, 'ce-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keinen CostEntry in Household A aktualisieren (Isolation)', async () => {
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

  it('User B kann keinen CostEntry in Household A loeschen (Isolation)', async () => {
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

  it('User B kann keine annual costs in Household A abrufen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.getAnnualCost(householdA, userB.id, policyInA),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine household summary in Household A abrufen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);

    await expect(
      service.getHouseholdSummary(householdA, userB.id),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keinen year comparison in Household A abrufen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.getYearComparison(householdA, userB.id, policyInA, 2025),
    ).rejects.toThrow(ForbiddenException);
  });
});
