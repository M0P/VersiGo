import { describe, it, expect, vi } from 'vitest';
import { CostTrackingController, CostTrackingHouseholdController } from '../cost-tracking.controller';
import { UserStatus } from '@prisma/client';
import { PaymentFrequency } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  create: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getAnnualCost: ReturnType<typeof vi.fn>;
  getYearComparison: ReturnType<typeof vi.fn>;
  getHouseholdSummary: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getAnnualCost: vi.fn(),
    getYearComparison: vi.fn(),
    getHouseholdSummary: vi.fn(),
  };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@example.com',
  displayName: 'A',
  status: UserStatus.ACTIVE,
  memberships: [],
};

describe('CostTrackingController', () => {
  const householdId = 'household-1';
  const policyId = 'policy-1';
  const entryId = 'entry-1';

  it('create delegiert an Service und gibt Ergebnis zurueck', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    const expected = { id: entryId, grossAmount: 1200 };
    service.create.mockResolvedValue(expected);

    const result = await controller.create(householdId, policyId, mockUser, {
      validFrom: '2025-01-01',
      grossAmount: 1200,
      frequency: PaymentFrequency.MONTHLY,
    });

    expect(result).toEqual(expected);
    expect(service.create).toHaveBeenCalledWith(householdId, mockUser.id, policyId, {
      validFrom: '2025-01-01',
      grossAmount: 1200,
      frequency: PaymentFrequency.MONTHLY,
    });
  });

  it('findAll delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.findAll.mockResolvedValue([{ id: entryId }]);

    const result = await controller.findAll(householdId, policyId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('findOne delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.findOne.mockResolvedValue({ id: entryId });

    const result = await controller.findOne(householdId, policyId, entryId, mockUser);

    expect(result).toEqual({ id: entryId });
    expect(service.findOne).toHaveBeenCalledWith(householdId, mockUser.id, policyId, entryId);
  });

  it('update delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.update.mockResolvedValue({ id: entryId, grossAmount: 1500 });

    const result = await controller.update(householdId, policyId, entryId, mockUser, {
      grossAmount: 1500,
    });

    expect(result.grossAmount).toBe(1500);
    expect(service.update).toHaveBeenCalledWith(householdId, mockUser.id, policyId, entryId, {
      grossAmount: 1500,
    });
  });

  it('remove delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.remove.mockResolvedValue({ success: true });

    const result = await controller.remove(householdId, policyId, entryId, mockUser);

    expect(result.success).toBe(true);
    expect(service.remove).toHaveBeenCalledWith(householdId, mockUser.id, policyId, entryId);
  });

  it('getAnnualCost delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.getAnnualCost.mockResolvedValue({ policyId, annualGross: 1200 });

    const result = await controller.getAnnualCost(householdId, policyId, mockUser);

    expect(result.annualGross).toBe(1200);
    expect(service.getAnnualCost).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('getYearComparison delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.getYearComparison.mockResolvedValue({ policyId, absoluteChange: 100 });

    const result = await controller.getYearComparison(householdId, policyId, mockUser, '2025');

    expect(result.absoluteChange).toBe(100);
    expect(service.getYearComparison).toHaveBeenCalledWith(householdId, mockUser.id, policyId, 2025);
  });
});

describe('CostTrackingHouseholdController', () => {
  const householdId = 'household-1';

  it('getSummary delegiert an Service', async () => {
    const service = createMockService();
    const controller = new CostTrackingHouseholdController(service as never);
    service.getHouseholdSummary.mockResolvedValue({ totalAnnualGross: 5000, perType: {}, policyCount: 3 });

    const result = await controller.getSummary(householdId, mockUser);

    expect(result.totalAnnualGross).toBe(5000);
    expect(service.getHouseholdSummary).toHaveBeenCalledWith(householdId, mockUser.id);
  });
});
