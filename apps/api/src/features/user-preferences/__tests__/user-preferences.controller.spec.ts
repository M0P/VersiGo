import { describe, it, expect, vi } from 'vitest';
import { ROLES_KEY } from '../../identity/roles.decorator';
import { GlobalRole } from '@prisma/client';
import { UserPreferencesController } from '../user-preferences.controller';

describe('UserPreferencesController', () => {
  it('requires the USER role (or higher) at the controller level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, UserPreferencesController);
    expect(roles).toContain(GlobalRole.USER);
  });

  it('set delegates the own user ID, key and DTO to the service', async () => {
    const service = {
      setPreference: vi.fn().mockResolvedValue({ key: 'theme', value: 'dark' }),
    };
    const controller = new UserPreferencesController(service as never);

    const result = await controller.set(
      { id: 'user-1' } as never,
      'theme',
      { value: 'dark' },
    );

    expect(result).toEqual({ key: 'theme', value: 'dark' });
    expect(service.setPreference).toHaveBeenCalledWith('user-1', 'theme', 'dark');
  });
});
