import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PolicyRegistryService } from '../policy-registry.service';
import { ForbiddenException } from '@nestjs/common';

function createMockDb() {
  return {
    householdMembership: {
      findUnique: vi.fn(),
    },
    insurancePolicy: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    coveredPerson: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    portalAccountLink: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  };
}

type MembershipCheck = {
  userId: string;
  householdId: string;
  role: string;
};

describe('Policy-Registry Household-Isolation (Integration)', () => {
  const householdA = 'household-aaaa';
  const householdB = 'household-bbbb';
  const userA = { id: 'user-aaaa' };
  const userB = { id: 'user-bbbb' };

  let mockDb: ReturnType<typeof createMockDb>;
  let service: PolicyRegistryService;

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
    service = new PolicyRegistryService(mockDb as never);
  });

  it('User A erstellt Policy in Household A (erlaubt)', async () => {
    setupMemberships([{ userId: userA.id, householdId: householdA, role: 'OWNER' }]);
    mockDb.insurancePolicy.create.mockResolvedValue({
      id: 'p1', householdId: householdA, ownerUserId: userA.id,
      coveredPersons: [], costEntries: [], documents: [], portalLinks: [],
    });

    const result = await service.create(householdA, userA.id, {
      type: 'HAFTPFLICHT',
      insurerName: 'A AG',
      contractNumber: 'A-123',
      startDate: '2025-01-01',
    });

    expect(result.householdId).toBe(householdA);
  });

  it('User A kann keine Policy in Household B erstellen (Isolation)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'OWNER' },
    ]);

    await expect(
      service.create(householdB, userA.id, {
        type: 'HAFTPFLICHT',
        insurerName: 'B AG',
        contractNumber: 'B-123',
        startDate: '2025-01-01',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine Policy in Household A sehen (Isolation, symmetrisch)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: 'p1', householdId: householdA, ownerUserId: userA.id,
      coveredPersons: [], costEntries: [], documents: [], portalLinks: [],
    });

    await expect(
      service.findOne(householdA, userB.id, 'p1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B sieht nur Policies aus Household B', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'MEMBER' },
    ]);
    mockDb.insurancePolicy.findMany.mockResolvedValue([
      { id: 'p2', householdId: householdB, coveredPersons: [], portalLinks: [] },
    ]);

    const result = await service.findAll(householdB, userB.id);

    expect(result).toHaveLength(1);
    expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: householdB, archivedAt: null } }),
    );
  });

  it('User A kann Policy in Household B nicht aktualisieren (Isolation)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: 'p-b', householdId: householdB, ownerUserId: userB.id,
    });

    await expect(
      service.update(householdB, userA.id, 'p-b', { insurerName: 'Hacked' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User A kann Policy in Household B nicht archivieren (Isolation)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: 'p-b', householdId: householdB,
    });

    await expect(
      service.remove(householdB, userA.id, 'p-b'),
    ).rejects.toThrow(ForbiddenException);
  });
});
