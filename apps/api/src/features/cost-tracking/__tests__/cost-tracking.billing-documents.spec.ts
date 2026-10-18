import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';

import { CostTrackingService } from '../cost-tracking.service';
import { AuthService } from '../../identity/auth.service';

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn> };
    policyCostEntry: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      /** Used by the `validFrom` collision check inside `create()`. */
      findFirst: ReturnType<typeof vi.fn>;
    };
    auditEvent: { create: ReturnType<typeof vi.fn> };
    objectShare: { findMany: ReturnType<typeof vi.fn> };
    policyDocument: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyCostEntry: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
    objectShare: { findMany: vi.fn() },
    policyDocument: { findFirst: vi.fn(), findMany: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

describe('CostTrackingService (AP-24 §4)', () => {
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';
  const user = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };

  let mockDb: ReturnType<typeof createMockDb>;
  let service: CostTrackingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    service = new CostTrackingService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
    );
    mockDb.householdMembership.findUnique.mockResolvedValue({
      householdId,
      userId,
      role: 'OWNER',
    });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
    // No other entry occupies the same period unless a test says otherwise.
    mockDb.policyCostEntry.findFirst.mockResolvedValue(null);
  });

  it('listBillingDocuments returns BILLING documents with their cost references', async () => {
    mockDb.policyDocument.findMany.mockResolvedValue([
      { id: 'doc1', fileName: 'rechnung.pdf', documentClass: 'BILLING' },
      { id: 'doc2', fileName: 'vertrag.pdf', documentClass: 'CONTRACT' },
    ]);
    mockDb.policyCostEntry.findMany.mockResolvedValue([
      { id: 'entry1', sourceDocumentId: 'doc1', validFrom: new Date('2026-01-01'), amount: 120, frequency: 'ANNUAL' },
    ]);

    const result = await service.listBillingDocuments(householdId, user, policyId);

    expect(result.documents).toHaveLength(2);
    expect(mockDb.policyDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ documentClass: 'BILLING' }),
      }),
    );
    expect(result.documents[0].usedByCostEntries).toEqual([
      { id: 'entry1', validFrom: new Date('2026-01-01'), amount: 120, frequency: 'ANNUAL' },
    ]);
    expect(result.documents[1].usedByCostEntries).toEqual([]);
  });

  it('listBillingDocuments refuses without a membership', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue(null);

    await expect(service.listBillingDocuments(householdId, user, policyId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('create stores sourceDocumentId for a valid BILLING document', async () => {
    mockDb.policyDocument.findFirst.mockResolvedValue({
      id: 'doc1',
      policyId,
      documentClass: 'BILLING',
      isArchived: false,
    });
    mockDb.policyCostEntry.create.mockResolvedValue({ id: 'entry1' });

    await service.create(householdId, userId, policyId, {
      validFrom: '2026-01-01',
      amount: 100,
      frequency: 'ANNUAL',
      sourceDocumentId: 'doc1',
    } as never);

    expect(mockDb.policyCostEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceDocumentId: 'doc1' }),
      }),
    );
  });

  it('create refuses sourceDocumentId belonging to another policy', async () => {
    // The lookup is `where: { id, policyId, archivedAt: null }`, so a document
    // of a different policy matches no row at all. A `null` here is exactly
    // what the database answers for a foreign document – which is why the
    // service must refuse instead of storing the dangling reference.
    mockDb.policyDocument.findFirst.mockResolvedValue(null);

    await expect(
      service.create(householdId, userId, policyId, {
        validFrom: '2026-01-01',
        amount: 10,
        frequency: 'MONTHLY',
        sourceDocumentId: 'docX',
      } as never),
    ).rejects.toThrow('does not belong to this policy');

    // Nothing is written for a refused reference.
    expect(mockDb.policyCostEntry.create).not.toHaveBeenCalled();
  });

  it('create refuses sourceDocumentId that is not classified as BILLING', async () => {
    mockDb.policyDocument.findFirst.mockResolvedValue({
      id: 'doc1',
      policyId,
      documentClass: 'CONTRACT',
      isArchived: false,
    });

    await expect(
      service.create(householdId, userId, policyId, {
        validFrom: '2026-01-01',
        amount: 10,
        frequency: 'MONTHLY',
        sourceDocumentId: 'doc1',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
