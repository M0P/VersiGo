import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostTrackingService } from '../cost-tracking.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentFrequency, GlobalRole, UserStatus } from '@prisma/client';
import { AuthService } from '../../identity/auth.service';

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    policyCostEntry: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
    objectShare: { findMany: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn(), findMany: vi.fn() },
    policyCostEntry: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
    objectShare: { findMany: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

type MockDb = ReturnType<typeof createMockDb>;

describe('CostTrackingService', () => {
  let mockDb: MockDb;
  let service: CostTrackingService;
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';
  const entryId = 'entry-1';
  const user = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };

  beforeEach(() => {
    mockDb = createMockDb();
    service = new CostTrackingService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
    );
  });

  function mockMembership() {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
  }

  function mockPolicy(policy: Record<string, unknown> = {}) {
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, ...policy });
  }

  describe('create', () => {
    it('creates a cost entry and logs an audit', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.create.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        grossAmount: 1200,
        frequency: 'MONTHLY',
      });

      const result = await service.create(householdId, userId, policyId, {
        validFrom: '2025-01-01',
        grossAmount: 1200,
        frequency: PaymentFrequency.MONTHLY,
      });

      expect(result.id).toBe(entryId);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'PolicyCostEntry',
            action: 'CREATE',
          }),
        }),
      );
    });

    it('BugFix-22: accepts an entry with only a net amount', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.create.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        grossAmount: null,
        netAmount: 1000,
        frequency: 'MONTHLY',
      });

      const result = await service.create(householdId, userId, policyId, {
        validFrom: '2025-01-01',
        netAmount: 1000,
        frequency: PaymentFrequency.MONTHLY,
      });

      expect(result.id).toBe(entryId);
      expect(mockDb.policyCostEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ netAmount: 1000 }),
        }),
      );
    });

    it('BugFix-22: refuses an entry without any amount', async () => {
      mockMembership();
      mockPolicy();

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDb.policyCostEntry.create).not.toHaveBeenCalled();
    });

    it('BugFix-08: ends the predecessor automatically on cost increase (validFrom)', async () => {
      mockMembership();
      mockPolicy();
      // Existing entry from 01.01.2024 (open), new increase from 01.01.2025.
      // findMany mirrors the view of the interactive transaction: the just
      // created entry is already visible and must NOT be ended as its own
      // predecessor.
      mockDb.policyCostEntry.create.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        grossAmount: 150,
        frequency: 'MONTHLY',
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
        {
          id: entryId,
          grossAmount: 150,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        },
      ]);

      await service.create(householdId, userId, policyId, {
        validFrom: '2025-01-01',
        grossAmount: 150,
        frequency: PaymentFrequency.MONTHLY,
      });

      // Predecessor (c1) is set to the last millisecond before the new validFrom
      // – NOT the newly created entry itself.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: new Date('2024-12-31T23:59:59.999Z') }),
        }),
      );
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ diffJson: expect.objectContaining({ predecessorEnded: true }) }),
        }),
      );
    });

    it('refuses creation without household membership', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
          grossAmount: 1200,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses creation when the policy is missing', async () => {
      mockMembership();
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
          grossAmount: 1200,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses creation when validTo <= validFrom', async () => {
      mockMembership();
      mockPolicy();

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-06-01',
          validTo: '2025-01-01',
          grossAmount: 100,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses creation on duplicate validFrom', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({ id: 'c1' });

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
          grossAmount: 100,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns all cost entries of a policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        { id: 'e1', policyId, grossAmount: 100, frequency: 'MONTHLY' },
        { id: 'e2', policyId, grossAmount: 200, frequency: 'ANNUAL' },
      ]);

      const result = await service.findAll(householdId, user, policyId);

      expect(result).toHaveLength(2);
      expect(mockDb.policyCostEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId } }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the CostEntry is missing', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, user, policyId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns a cost entry', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 500,
        frequency: 'QUARTERLY',
      });

      const result = await service.findOne(householdId, user, policyId, entryId);

      expect(result.id).toBe(entryId);
    });
  });

  describe('update', () => {
    it('updates a cost entry and logs an audit', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        validTo: null,
      });
      mockDb.policyCostEntry.update.mockResolvedValue({
        id: entryId,
        grossAmount: 1500,
        frequency: 'MONTHLY',
      });

      const result = await service.update(householdId, userId, policyId, entryId, {
        grossAmount: 1500,
      });

      expect(result.grossAmount).toBe(1500);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE' }),
        }),
      );
    });

    it('BugFix-22: refuses an update that would clear both amounts', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        validTo: null,
        grossAmount: null,
        netAmount: 1000,
        frequency: 'MONTHLY',
      });

      await expect(
        service.update(householdId, userId, policyId, entryId, { netAmount: null as never }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDb.policyCostEntry.update).not.toHaveBeenCalled();
    });

    it('BugFix-22: allows an update that keeps the net amount as the only amount', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        validTo: null,
        grossAmount: null,
        netAmount: 1000,
        frequency: 'MONTHLY',
      });
      mockDb.policyCostEntry.update.mockResolvedValue({
        id: entryId,
        netAmount: 1100,
        frequency: 'MONTHLY',
      });

      const result = await service.update(householdId, userId, policyId, entryId, {
        netAmount: 1100,
      });

      expect(result.netAmount).toBe(1100);
    });

    it('refuses update when validTo <= validFrom', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-06-01'),
        validTo: null,
        grossAmount: 100,
        frequency: PaymentFrequency.MONTHLY,
      });

      await expect(
        service.update(householdId, userId, policyId, entryId, {
          validTo: '2025-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('BugFix-08: re-synchronizes the predecessor when validFrom changes', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) edited entry, 2) collision check, 3) restorePredecessor.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-06-01'),
          validTo: null,
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockDb.policyCostEntry.update.mockResolvedValue({
        id: entryId,
        grossAmount: 150,
        frequency: 'MONTHLY',
      });
      // findMany mirrors the transaction view: the edited entry is also
      // visible and must NOT be ended as its own predecessor.
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
        {
          id: entryId,
          grossAmount: 150,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-06-01'),
          validTo: null,
        },
      ]);

      await service.update(householdId, userId, policyId, entryId, {
        validFrom: '2025-07-01',
      });

      // c1 is ended at the last millisecond before the new validFrom –
      // not the edited entry itself.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: new Date('2025-06-30T23:59:59.999Z') }),
        }),
      );
    });

    it('BugFix-08: validFrom shifted backwards closes the gap (predecessor is reopened)', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) edited entry, 2) collision check, 3) restorePredecessor.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: null,
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c1' });
      // update: 1) the entry itself, 2) c1 reopened, 3) c1 ended at the new validFrom.
      mockDb.policyCostEntry.update
        .mockResolvedValueOnce({ id: entryId, grossAmount: 150, frequency: 'MONTHLY' })
        .mockResolvedValueOnce({ id: 'c1', validTo: null })
        .mockResolvedValueOnce({ id: 'c1', validTo: new Date('2026-12-31T23:59:59.999Z') });
      // Transaction view AFTER restorePredecessor: c1 is reopened (validTo
      // null) and exists next to the edited entry c2.
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
        {
          id: entryId,
          grossAmount: 150,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        },
      ]);

      await service.update(householdId, userId, policyId, entryId, {
        validFrom: '2027-01-01',
      });

      // 1) c1 is reopened first (no period without an entry) ...
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: null }),
        }),
      );
      // 2) ... and then ended at the NEW validFrom (covers 2025+2026).
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: new Date('2026-12-31T23:59:59.999Z') }),
        }),
      );
    });

    it('BugFix-08: validFrom shifted behind its own auto-ended validTo removes the obsolete validTo (middle entry, review 3)', async () => {
      mockMembership();
      mockPolicy();
      // c2 was auto-ended by c3: validTo = 2025-05-31T23:59:59.999.
      // findFirst: 1) edited entry, 2) auto-end signature (c3 begins
      // 1ms after c2.validTo), 3) collision check, 4) restorePredecessor.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: new Date('2025-05-31T23:59:59.999Z'),
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce({ id: 'c3' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c1' });
      // update: 1) c2 itself (obsolete validTo removed), 2) c1 reopened,
      // 3) c3 ended at the new validFrom.
      mockDb.policyCostEntry.update
        .mockResolvedValueOnce({ id: entryId, grossAmount: 150, frequency: 'MONTHLY', validTo: null })
        .mockResolvedValueOnce({ id: 'c1', validTo: null })
        .mockResolvedValueOnce({ id: 'c3', validTo: new Date('2025-12-31T23:59:59.999Z') });
      // Transaction view after restorePredecessor: c1 open, c2 excluded,
      // c3 open.
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: null },
        { id: entryId, grossAmount: 150, frequency: 'MONTHLY', validFrom: new Date('2025-01-01'), validTo: null },
        { id: 'c3', grossAmount: 200, frequency: 'MONTHLY', validFrom: new Date('2025-06-01'), validTo: null },
      ]);

      await service.update(householdId, userId, policyId, entryId, {
        validFrom: '2026-01-01',
      });

      // 1) c2: the obsolete (auto-ended) validTo is dropped – the entry
      // becomes active from the new validFrom.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: entryId },
          data: expect.objectContaining({ validFrom: new Date('2026-01-01'), validTo: null }),
        }),
      );
      // 2) c1 is reopened (covers until the next increase).
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ validTo: null }) }),
      );
      // 3) c3 is ended at the new validFrom – no period without an entry.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c3' },
          data: expect.objectContaining({ validTo: new Date('2025-12-31T23:59:59.999Z') }),
        }),
      );
    });

    it('BugFix-08: a manually set validTo is not silently removed when validFrom is shifted (review 4)', async () => {
      mockMembership();
      mockPolicy();
      // Manually set validTo (2025-06-30) WITHOUT a successor signature:
      // no entry begins exactly 1ms later (2025-07-01).
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: new Date('2025-06-30'),
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.update(householdId, userId, policyId, entryId, {
          validFrom: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('deletes a CostEntry and logs an audit', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) entry to delete, 2) restorePredecessor (nothing ended).
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          grossAmount: 100,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null);
      mockDb.policyCostEntry.delete.mockResolvedValue({ id: entryId });

      const result = await service.remove(householdId, userId, policyId, entryId);

      expect(result.success).toBe(true);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityId: entryId,
            action: 'DELETE',
          }),
        }),
      );
    });

    it('BugFix-22: audit diff of a net-only entry stays null instead of NaN', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) entry to delete, 2) restorePredecessor (nothing ended).
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          grossAmount: null,
          netAmount: 900,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null);
      mockDb.policyCostEntry.delete.mockResolvedValue({ id: entryId });

      await service.remove(householdId, userId, policyId, entryId);

      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DELETE',
            diffJson: expect.objectContaining({ grossAmount: null, netAmount: 900 }),
          }),
        }),
      );
    });

    it('BugFix-08: deleting an increase reopens the predecessor (no gap)', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) entry to delete (increase from 2025-01-01),
      // 2) restorePredecessor finds the auto-ended predecessor c1.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: null,
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce({ id: 'c1' });
      mockDb.policyCostEntry.delete.mockResolvedValue({ id: entryId });
      mockDb.policyCostEntry.update.mockResolvedValue({ id: 'c1', validTo: null });

      await service.remove(householdId, userId, policyId, entryId);

      // c1 (ended at 2024-12-31T23:59:59.999) is reopened.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: null }),
        }),
      );
    });
  });

  describe('getSchedule (BugFix-08: period table incurred/expected)', () => {
    function mockScheduleData(
      policy: Record<string, unknown>,
      entries: Array<Record<string, unknown>>,
    ) {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, ...policy });
      mockDb.policyCostEntry.findMany.mockResolvedValue(entries);
    }

    it('paidToDate = sum of fully started periods (no daily fractions)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-15'),
            validTo: null,
          },
        ],
      );

      // Fixed point in time: 3 full periods started (15.01., 15.02., 15.03.).
      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.current?.frequency).toBe('MONTHLY');
      expect(result.paidToDate.gross).toBe(300);
      expect(result.paidToDate.net).toBeNull();
      // Past = incurred, future = expected (projected from the active entry).
      expect(result.periods[0].status).toBe('incurred');
      expect(result.periods[0].amount.gross).toBe(100);
      expect(result.periods[2].periodLabel).toBe('03/2024');
      expect(result.periods[2].status).toBe('incurred');
      expect(result.periods[3].status).toBe('expected');
      expect(result.periods[3].amount.gross).toBe(100);
    });

    it('BugFix-22: does NOT fall back to net when no gross amount is set', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: null,
            netAmount: 90,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      // 3 incurred monthly periods (01-03/2024) at 90 net each; the gross
      // basis stays null (UI: dash) and is never replaced by the net amount.
      expect(result.paidToDate).toEqual({ gross: null, net: 270 });
      expect(result.current?.amount).toEqual({ gross: null, net: 90 });
      expect(result.current?.annual).toEqual({ gross: null, net: 1080 });
      expect(result.periods[0].amount).toEqual({ gross: null, net: 90 });
    });

    it('BugFix-22: periods start at the first cost position when it precedes the policy start', async () => {
      mockScheduleData(
        { startDate: new Date('2026-08-16'), paymentFrequency: PaymentFrequency.ANNUAL },
        [
          {
            id: 'c1',
            grossAmount: null,
            netAmount: 701.59,
            frequency: 'ANNUAL',
            validFrom: new Date('2024-10-23'),
            validTo: new Date('2025-10-22T23:59:59.999'),
          },
          {
            id: 'c2',
            grossAmount: null,
            netAmount: 761.01,
            frequency: 'ANNUAL',
            validFrom: new Date('2025-10-23'),
            validTo: new Date('2026-10-22T23:59:59.999'),
          },
          {
            id: 'c3',
            grossAmount: null,
            netAmount: 718.22,
            frequency: 'ANNUAL',
            validFrom: new Date('2026-10-23'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2026-10-18T09:00:00.000Z'),
      );

      // Anchor 23.10.2024 (not the policy start 16.08.2026): all earlier
      // periods are present, paid to date = 701.59 + 761.01 = 1462.60.
      expect(result.periods.map((p) => p.periodLabel)).toEqual([
        '10/2024',
        '10/2025',
        '10/2026',
        '10/2027',
      ]);
      expect(result.paidToDate).toEqual({ gross: null, net: 1462.6 });
      expect(result.periods.map((p) => p.status)).toEqual([
        'incurred',
        'incurred',
        'expected',
        'expected',
      ]);
    });

    it('uses the yearly frequency of the policy (annual, 01/2024, ...)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.ANNUAL },
        [
          {
            id: 'c1',
            grossAmount: 500,
            netAmount: null,
            frequency: 'ANNUAL',
            validFrom: new Date('2024-01-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.paidToDate.gross).toBe(500);
      expect(result.periods[0].periodLabel).toBe('01/2024');
      expect(result.periods[0].status).toBe('incurred');
      expect(result.current?.annual.gross).toBe(500);
    });

    it('BugFix-08: frequency switch – increase from 06/2024 flows into all following periods', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-15'),
            validTo: new Date('2024-06-14'),
          },
          {
            id: 'c2',
            grossAmount: 120,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-06-15'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-08-31T12:00:00.000Z'),
      );

      // 5 periods of 100 (01-05/2024) + 3 periods of 120 (06-08/2024).
      expect(result.paidToDate.gross).toBe(5 * 100 + 3 * 120);
      expect(result.periods[5].periodLabel).toBe('06/2024');
      expect(result.periods[5].amount.gross).toBe(120);
      expect(result.periods[6].amount.gross).toBe(120);
      expect(result.current?.amount.gross).toBe(120);
    });

    it('BugFix-08: cost increase mid-year (increase-mid-year)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-01'),
            validTo: new Date('2024-05-31'),
          },
          {
            id: 'c2',
            grossAmount: 150,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-06-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-12-15T12:00:00.000Z'),
      );

      // All 12 periods of 2024 started: 5 * 100 + 7 * 150.
      expect(result.paidToDate.gross).toBe(5 * 100 + 7 * 150);
      expect(result.periods[4].amount.gross).toBe(100);
      expect(result.periods[5].amount.gross).toBe(150);
    });

    it('scales entries whose frequency differs from the billing frequency', async () => {
      // Insurance MONTHLY, cost entry QUARTERLY (300): each monthly period
      // owes 300/3 = 100 – the annual sum stays consistent.
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 300,
            netAmount: null,
            frequency: 'QUARTERLY',
            validFrom: new Date('2024-01-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.paidToDate.gross).toBe(300);
      for (const period of result.periods.slice(0, 3)) {
        expect(period.amount.gross).toBe(100);
      }
    });

    it('realigns periods after short months at the anchor (leap year 2024)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-31'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-31'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-31T12:00:00.000Z'),
      );

      expect(result.periods[0].periodStart).toBe('2024-01-31T00:00:00.000Z');
      expect(result.periods[1].periodStart).toBe('2024-02-29T00:00:00.000Z');
      expect(result.periods[2].periodStart).toBe('2024-03-31T00:00:00.000Z');
    });

    it('returns an empty period list without cost entries', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
        [],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.paidToDate).toEqual({ gross: null, net: null });
      expect(result.current).toBeNull();
      expect(result.periods).toEqual([]);
    });

    it('throws NotFoundException when the policy is missing', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.getSchedule(householdId, user, policyId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHouseholdSummary (BugFix-08 Q5: household overview)', () => {
    it('aggregates paidToDate, month, year and per-year buckets across all policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'HAFTPFLICHT',
          insurerName: 'P1',
          costEntries: [
            { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
        {
          id: 'p2',
          householdId,
          type: 'HAUSRAT',
          insurerName: 'P2',
          costEntries: [
            { id: 'c2', grossAmount: 500, frequency: 'ANNUAL', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2025-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(2);
      // p1: 15 monthly periods started (01/2024-03/2025) -> 1500, p2: 2 yearly periods -> 1000.
      expect(result.totals.paidToDate).toEqual({ gross: 2500, net: null });
      expect(result.totals.perYear).toEqual({ gross: 1700, net: null });
      // 100 (MONTHLY) + 500/12 (ANNUAL) = 141.67.
      expect(result.totals.perMonth).toEqual({ gross: 141.67, net: null });
      // Historical buckets: 2024 -> 1200 + 500, 2025 -> 3 * 100 + 500.
      expect(result.perYear).toEqual([
        { year: 2024, amount: { gross: 1700, net: null } },
        { year: 2025, amount: { gross: 800, net: null } },
      ]);
      expect(result.policies[0].paidToDate).toEqual({ gross: 1500, net: null });
      expect(result.policies[0].perMonth).toEqual({ gross: 100, net: null });
    });

    it('bugFix-08: perYear bucket accounts for a cost increase mid-year', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'KFZ',
          insurerName: 'P1',
          costEntries: [
            { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: new Date('2024-06-30') },
            { id: 'c2', grossAmount: 150, frequency: 'MONTHLY', validFrom: new Date('2024-07-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2024-12-31T12:00:00.000Z'),
      );

      // 6 * 100 + 6 * 150 = 1500 in the year 2024.
      expect(result.perYear).toEqual([{ year: 2024, amount: { gross: 1500, net: null } }]);
      expect(result.totals.paidToDate).toEqual({ gross: 1500, net: null });
    });

    it('ignores archived policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(0);
      expect(result.totals.paidToDate).toEqual({ gross: null, net: null });
      expect(result.totals.perYear).toEqual({ gross: null, net: null });
      expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null },
        }),
      );
    });

    it('handles policies without cost entries', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        { id: 'p1', householdId, type: 'HAFTPFLICHT', insurerName: 'P1', costEntries: [] },
        {
          id: 'p2',
          householdId,
          type: 'HAUSRAT',
          insurerName: 'P2',
          costEntries: [
            { id: 'c2', grossAmount: 1000, frequency: 'ANNUAL', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(2);
      expect(result.policies[0].paidToDate).toEqual({ gross: null, net: null });
      expect(result.policies[0].entryCount).toBe(0);
      expect(result.totals.paidToDate).toEqual({ gross: 1000, net: null });
    });

    it('READ_ONLY: sums only explicitly shared policies (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };
      // No shares -> getReadablePolicyIds returns [].
      mockDb.objectShare.findMany.mockResolvedValue([]);
      mockDb.insurancePolicy.findMany.mockResolvedValue([]);

      const result = await service.getHouseholdSummary(
        householdId,
        readOnlyUser,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(0);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null, id: { in: [] } },
        }),
      );
    });

    it('READ_ONLY: uses shared policy IDs as a filter', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };
      mockDb.objectShare.findMany.mockResolvedValue([
        { scopeType: 'INSURANCE', scopeRef: 'p1', sourceUserId: userId },
      ]);
      mockDb.insurancePolicy.findMany
        .mockResolvedValueOnce([{ id: 'p1', householdId, archivedAt: null, type: 'KFZ', insurerName: 'P1' }]) // getReadablePolicyIds
        .mockResolvedValueOnce([]); // Summary without hits (share covers nothing)

      const result = await service.getHouseholdSummary(
        householdId,
        readOnlyUser,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(0);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null, id: { in: ['p1'] } },
        }),
      );
    });
  });

  describe('Household isolation', () => {
    it('refuses access without membership for findAll', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.findAll(householdId, user, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses access without membership for getSchedule', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.getSchedule(householdId, user, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses access without membership for getHouseholdSummary', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.getHouseholdSummary(householdId, user),
      ).rejects.toThrow(ForbiddenException);
    });

    it('READ_ONLY: refuses findAll without explicit share (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.objectShare.findMany.mockResolvedValue([]);
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };

      await expect(
        service.findAll(householdId, readOnlyUser, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('READ_ONLY: refuses findOne without explicit share (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.objectShare.findMany.mockResolvedValue([]);
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };

      await expect(
        service.findOne(householdId, readOnlyUser, policyId, entryId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('READ_ONLY: refuses getSchedule without explicit share (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.objectShare.findMany.mockResolvedValue([]);
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };

      await expect(
        service.getSchedule(householdId, readOnlyUser, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    // Review round 2 (M1): a mock answers whatever it is handed, so a query
    // that silently lost its scoping filter would still return rows and the
    // behavioural assertion above would keep passing. Pinning the argument an
    // implementation accident has nowhere to hide.
    it('scopes the policy lookup used by read access to id AND household', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findMany.mockResolvedValue([]);

      await service.findAll(householdId, user, policyId);

      expect(mockDb.insurancePolicy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: policyId, householdId } }),
      );
    });

    it('scopes findOne to the entry id AND the policy at once', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({ id: entryId, policyId });

      await service.findOne(householdId, user, policyId, entryId);

      expect(mockDb.policyCostEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: entryId, policyId } }),
      );
    });

    it('scopes getSchedule to one household and one policy', async () => {
      mockMembership();
      mockDb.insurancePolicy.findFirst.mockResolvedValue({
        id: policyId,
        householdId,
        startDate: new Date('2024-01-15'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([]);

      await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(mockDb.insurancePolicy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: policyId, householdId } }),
      );
      expect(mockDb.policyCostEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId } }),
      );
    });
  });
});
