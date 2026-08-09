import { describe, it, expect, vi } from 'vitest';
import { CostTrackingController, CostTrackingHouseholdController } from '../cost-tracking.controller';
import { ROLES_KEY } from '../../identity/roles.decorator';
import { GlobalRole, UserStatus } from '@prisma/client';
import { PaymentFrequency } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  create: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getSchedule: ReturnType<typeof vi.fn>;
  getHouseholdSummary: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getSchedule: vi.fn(),
    getHouseholdSummary: vi.fn(),
  };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'alice',
  displayName: 'A',
  role: GlobalRole.USER,
  status: UserStatus.ACTIVE,
  memberships: [],
};

describe('CostTrackingController', () => {
  const householdId = 'household-1';
  const policyId = 'policy-1';
  const entryId = 'entry-1';

  it('create delegates to the service and returns the result', async () => {
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

  it('findAll delegates to the service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.findAll.mockResolvedValue([{ id: entryId }]);

    const result = await controller.findAll(householdId, policyId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(householdId, mockUser, policyId);
  });

  it('getSchedule delegates to the service (BugFix-08: period table)', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.getSchedule.mockResolvedValue({ policyId, paidToDate: 1200, periods: [] });

    const result = await controller.getSchedule(householdId, policyId, mockUser);

    expect(result.paidToDate).toBe(1200);
    expect(service.getSchedule).toHaveBeenCalledWith(householdId, mockUser, policyId);
  });

  it('findOne delegates to the service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.findOne.mockResolvedValue({ id: entryId });

    const result = await controller.findOne(householdId, policyId, entryId, mockUser);

    expect(result).toEqual({ id: entryId });
    expect(service.findOne).toHaveBeenCalledWith(householdId, mockUser, policyId, entryId);
  });

  it('update delegates to the service', async () => {
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

  it('remove delegates to the service', async () => {
    const service = createMockService();
    const controller = new CostTrackingController(service as never);
    service.remove.mockResolvedValue({ success: true });

    const result = await controller.remove(householdId, policyId, entryId, mockUser);

    expect(result.success).toBe(true);
    expect(service.remove).toHaveBeenCalledWith(householdId, mockUser.id, policyId, entryId);
  });
});

describe('CostTrackingController Rollen-Guards', () => {
  it('write endpoints only allow USER/ADMIN (READ_ONLY excluded)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingController.prototype.create)).toEqual([GlobalRole.USER, GlobalRole.ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingController.prototype.update)).toEqual([GlobalRole.USER, GlobalRole.ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingController.prototype.remove)).toEqual([GlobalRole.USER, GlobalRole.ADMIN]);
  });

  it('read endpoints also allow READ_ONLY (the share is enforced in the service, AP-16)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingController.prototype.findAll)).toContain(GlobalRole.READ_ONLY);
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingController.prototype.getSchedule)).toContain(GlobalRole.READ_ONLY);
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingController.prototype.findOne)).toContain(GlobalRole.READ_ONLY);
  });

  it('household summary also allows READ_ONLY (filtering in the service)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CostTrackingHouseholdController.prototype.getSummary)).toContain(GlobalRole.READ_ONLY);
  });
});

describe('CostTrackingHouseholdController', () => {
  const householdId = 'household-1';

  it('getSummary delegates to the service', async () => {
    const service = createMockService();
    const controller = new CostTrackingHouseholdController(service as never);
    service.getHouseholdSummary.mockResolvedValue({
      totals: { paidToDate: 5000, perMonth: 400, perYear: 4800 },
      perYear: [],
      policyCount: 3,
    });

    const result = await controller.getSummary(householdId, mockUser);

    expect(result.totals.paidToDate).toBe(5000);
    expect(service.getHouseholdSummary).toHaveBeenCalledWith(householdId, mockUser);
  });
});
