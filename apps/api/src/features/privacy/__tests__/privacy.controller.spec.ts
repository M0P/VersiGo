import { describe, it, expect, vi } from 'vitest';
import { PrivacyController } from '../privacy.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  role: GlobalRole.USER,
  status: UserStatus.ACTIVE,
  memberships: [],
};

describe('PrivacyController', () => {
  it('export uses exclusively the session identity (no IDOR)', async () => {
    const service = { exportPersonalData: vi.fn(), deleteAccount: vi.fn() };
    const controller = new PrivacyController(service as never);
    service.exportPersonalData.mockResolvedValue({ exportedAt: 'x' });

    const result = await controller.export(mockUser);

    expect(result).toEqual({ exportedAt: 'x' });
    expect(service.exportPersonalData).toHaveBeenCalledWith('user-1');
  });

  it('deleteAccount delegates to the service and returns 204', async () => {
    const service = { exportPersonalData: vi.fn(), deleteAccount: vi.fn() };
    const controller = new PrivacyController(service as never);
    service.deleteAccount.mockResolvedValue(undefined);

    await expect(controller.deleteAccount(mockUser)).resolves.toBeUndefined();
    expect(service.deleteAccount).toHaveBeenCalledWith(mockUser);
  });
});
