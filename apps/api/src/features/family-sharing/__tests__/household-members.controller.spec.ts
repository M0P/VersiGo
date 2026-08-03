import { describe, it, expect, vi } from 'vitest';
import { HouseholdMembersController } from '../household-members.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  listMembers: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    listMembers: vi.fn(),
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

describe('HouseholdMembersController', () => {
  const householdId = 'household-1';

  it('delegates member listing to the service', async () => {
    const service = createMockService();
    const controller = new HouseholdMembersController(service as never);
    const expected = [
      { id: 'user-2', username: 'bob', displayName: 'B', role: GlobalRole.USER },
    ];
    service.listMembers.mockResolvedValue(expected);

    const result = await controller.listMembers(householdId, mockUser);

    expect(result).toEqual(expected);
    expect(service.listMembers).toHaveBeenCalledWith(householdId, mockUser.id);
  });
});
