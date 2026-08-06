import { describe, it, expect, vi } from 'vitest';
import { PolicyRegistryController } from '../policy-registry.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  create: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  findPinned: ReturnType<typeof vi.fn>;
  pin: ReturnType<typeof vi.fn>;
  unpin: ReturnType<typeof vi.fn>;
  addCoveredPerson: ReturnType<typeof vi.fn>;
  updateCoveredPerson: ReturnType<typeof vi.fn>;
  removeCoveredPerson: ReturnType<typeof vi.fn>;
  createPortalLink: ReturnType<typeof vi.fn>;
  updatePortalLink: ReturnType<typeof vi.fn>;
  removePortalLink: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    findPinned: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    addCoveredPerson: vi.fn(),
    updateCoveredPerson: vi.fn(),
    removeCoveredPerson: vi.fn(),
    createPortalLink: vi.fn(),
    updatePortalLink: vi.fn(),
    removePortalLink: vi.fn(),
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

describe('PolicyRegistryController', () => {
  const householdId = 'household-1';
  const policyId = 'policy-1';

  it('create delegiert an Service und gibt Ergebnis zurueck', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    const expected = { id: policyId, insurerName: 'Test AG' };
    service.create.mockResolvedValue(expected);

    const result = await controller.create(householdId, mockUser, {
      type: 'HAFTPFLICHT',
      insurerName: 'Test AG',
      contractNumber: 'POL-123',
      startDate: '2025-01-01',
    });

    expect(result).toEqual(expected);
    expect(service.create).toHaveBeenCalledWith(householdId, mockUser.id, {
      type: 'HAFTPFLICHT',
      insurerName: 'Test AG',
      contractNumber: 'POL-123',
      startDate: '2025-01-01',
    });
  });

  it('findAll delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.findAll.mockResolvedValue([{ id: policyId }]);

    const result = await controller.findAll(householdId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(householdId, mockUser);
  });

  it('findOne delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.findOne.mockResolvedValue({ id: policyId });

    const result = await controller.findOne(householdId, policyId, mockUser);

    expect(result).toEqual({ id: policyId });
    expect(service.findOne).toHaveBeenCalledWith(householdId, mockUser, policyId);
  });

  it('update delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.update.mockResolvedValue({ id: policyId, insurerName: 'Neue AG' });

    const result = await controller.update(householdId, policyId, mockUser, {
      insurerName: 'Neue AG',
    });

    expect(result.insurerName).toBe('Neue AG');
    expect(service.update).toHaveBeenCalledWith(householdId, mockUser.id, policyId, {
      insurerName: 'Neue AG',
    });
  });

  it('remove delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.remove.mockResolvedValue({ success: true });

    const result = await controller.remove(householdId, policyId, mockUser);

    expect(result.success).toBe(true);
    expect(service.remove).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('addCoveredPerson delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.addCoveredPerson.mockResolvedValue({ id: 'cp-1', personName: 'Maria' });

    const result = await controller.addCoveredPerson(householdId, policyId, mockUser, {
      personName: 'Maria',
      relationType: 'EHEPARTNER',
    });

    expect(result.personName).toBe('Maria');
  });

  it('createPortalLink delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.createPortalLink.mockResolvedValue({ id: 'pl-1', providerKey: 'test' });

    const result = await controller.createPortalLink(householdId, policyId, mockUser, {
      providerKey: 'test',
    });

    expect(result.providerKey).toBe('test');
  });

  it('findPinned delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.findPinned.mockResolvedValue([{ id: policyId, pinnedAt: new Date().toISOString() }]);

    const result = await controller.findPinned(householdId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findPinned).toHaveBeenCalledWith(householdId, mockUser);
  });

  it('pin delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    const pinned = { id: policyId, pinnedAt: new Date().toISOString() };
    service.pin.mockResolvedValue(pinned);

    const result = await controller.pin(householdId, policyId, mockUser);

    expect(result).toEqual(pinned);
    expect(service.pin).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('unpin delegiert an Service', async () => {
    const service = createMockService();
    const controller = new PolicyRegistryController(service as never);
    service.unpin.mockResolvedValue({ id: policyId, pinnedAt: null });

    const result = await controller.unpin(householdId, policyId, mockUser);

    expect(result.pinnedAt).toBeNull();
    expect(service.unpin).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });
});
