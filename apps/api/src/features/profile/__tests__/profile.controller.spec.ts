import { describe, it, expect, vi } from 'vitest';
import { ROLES_KEY } from '../../identity/roles.decorator';
import { GlobalRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';
import { ProfileController } from '../profile.controller';

type ServiceLike = {
  getProfile: ReturnType<typeof vi.fn>;
  updateProfile: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return { getProfile: vi.fn(), updateProfile: vi.fn() };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  role: GlobalRole.USER,
  status: 'ACTIVE' as never,
  memberships: [],
};

describe('ProfileController', () => {
  it('requires the USER role (or higher) at the controller level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ProfileController);
    expect(roles).toContain(GlobalRole.USER);
  });

  it('get delegates the own user ID to the service', async () => {
    const service = createMockService();
    const controller = new ProfileController(service as never);
    service.getProfile.mockResolvedValue({ id: 'user-1', displayName: 'Alice' });

    const result = await controller.get(mockUser);

    expect(result).toEqual({ id: 'user-1', displayName: 'Alice' });
    expect(service.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('update delegates the own user ID and the DTO to the service', async () => {
    const service = createMockService();
    const controller = new ProfileController(service as never);
    service.updateProfile.mockResolvedValue({ id: 'user-1', displayName: 'Alice B.' });

    const result = await controller.update(mockUser, { displayName: 'Alice B.' });

    expect(result.displayName).toBe('Alice B.');
    expect(service.updateProfile).toHaveBeenCalledWith('user-1', { displayName: 'Alice B.' });
  });
});
