import { describe, it, expect, vi } from 'vitest';
import { FamilySharingController } from '../family-sharing.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import { ObjectShareScopeType, ObjectSharePermission } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  create: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findIncoming: ReturnType<typeof vi.fn>;
  findOutgoing: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findIncoming: vi.fn(),
    findOutgoing: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
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

describe('FamilySharingController', () => {
  const householdId = 'household-1';
  const shareId = 'share-1';

  it('create delegates to the service and returns the result', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    const expected = { id: shareId, permission: ObjectSharePermission.READ };
    service.create.mockResolvedValue(expected);

    const result = await controller.create(householdId, mockUser, {
      targetUserId: 'user-2',
      scopeType: ObjectShareScopeType.INSURANCE,
      scopeRef: 'policy-1',
      permission: ObjectSharePermission.READ,
    });

    expect(result).toEqual(expected);
    expect(service.create).toHaveBeenCalledWith(householdId, mockUser.id, {
      targetUserId: 'user-2',
      scopeType: ObjectShareScopeType.INSURANCE,
      scopeRef: 'policy-1',
      permission: ObjectSharePermission.READ,
    });
  });

  it('findAll delegates to the service', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    service.findAll.mockResolvedValue([{ id: shareId }]);

    const result = await controller.findAll(householdId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(householdId, mockUser);
  });

  it('findIncoming delegates to the service', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    service.findIncoming.mockResolvedValue([{ id: shareId }]);

    const result = await controller.findIncoming(householdId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findIncoming).toHaveBeenCalledWith(householdId, mockUser.id);
  });

  it('findOutgoing delegates to the service', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    service.findOutgoing.mockResolvedValue([{ id: shareId }]);

    const result = await controller.findOutgoing(householdId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findOutgoing).toHaveBeenCalledWith(householdId, mockUser.id);
  });

  it('findOne delegates to the service', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    service.findOne.mockResolvedValue({ id: shareId });

    const result = await controller.findOne(householdId, shareId, mockUser);

    expect(result).toEqual({ id: shareId });
    expect(service.findOne).toHaveBeenCalledWith(householdId, mockUser, shareId);
  });

  it('update delegates to the service', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    service.update.mockResolvedValue({ id: shareId, permission: ObjectSharePermission.WRITE });

    const result = await controller.update(householdId, shareId, mockUser, {
      permission: ObjectSharePermission.WRITE,
    });

    expect(result.permission).toBe(ObjectSharePermission.WRITE);
    expect(service.update).toHaveBeenCalledWith(householdId, mockUser.id, shareId, {
      permission: ObjectSharePermission.WRITE,
    });
  });

  it('remove delegates to the service', async () => {
    const service = createMockService();
    const controller = new FamilySharingController(service as never);
    service.remove.mockResolvedValue({ success: true });

    const result = await controller.remove(householdId, shareId, mockUser);

    expect(result.success).toBe(true);
    expect(service.remove).toHaveBeenCalledWith(householdId, mockUser, shareId);
  });
});
