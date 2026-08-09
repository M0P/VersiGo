import { describe, it, expect, vi } from 'vitest';
import { ROLES_KEY } from '../../identity/roles.decorator';
import { GlobalRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';
import { SystemConfigController } from '../system-config.controller';

type ServiceLike = {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  testConnectivity: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
    testConnectivity: vi.fn(),
  };
}

const mockAdmin: AuthenticatedUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin',
  role: GlobalRole.ADMIN,
  status: 'ACTIVE' as never,
  memberships: [],
};

describe('SystemConfigController', () => {
  it('requires the ADMIN role at the controller level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, SystemConfigController);
    expect(roles).toContain(GlobalRole.ADMIN);
  });

  it('list delegates to the service', async () => {
    const service = createMockService();
    const controller = new SystemConfigController(service as never);
    service.list.mockResolvedValue([{ key: 'AI_ENABLED' }]);

    const result = await controller.list();

    expect(result).toEqual([{ key: 'AI_ENABLED' }]);
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it('get delegates to the service', async () => {
    const service = createMockService();
    const controller = new SystemConfigController(service as never);
    service.get.mockResolvedValue({ key: 'AI_ENABLED' });

    const result = await controller.get('AI_ENABLED');

    expect(result).toEqual({ key: 'AI_ENABLED' });
    expect(service.get).toHaveBeenCalledWith('AI_ENABLED');
  });

  it('update delegates user and DTO value to the service', async () => {
    const service = createMockService();
    const controller = new SystemConfigController(service as never);
    service.update.mockResolvedValue({ key: 'AI_ENABLED', source: 'UI' });

    const result = await controller.update(mockAdmin, 'AI_ENABLED', { value: 'true' });

    expect(result).toEqual({ key: 'AI_ENABLED', source: 'UI' });
    expect(service.update).toHaveBeenCalledWith('AI_ENABLED', 'true', mockAdmin);
  });

  it('reset delegates the user to the service', async () => {
    const service = createMockService();
    const controller = new SystemConfigController(service as never);
    service.reset.mockResolvedValue({ key: 'AI_ENABLED', source: 'DEFAULT' });

    const result = await controller.reset(mockAdmin, 'AI_ENABLED');

    expect(result.source).toBe('DEFAULT');
    expect(service.reset).toHaveBeenCalledWith('AI_ENABLED', mockAdmin);
  });

  it('test delegates user and key to the service', async () => {
    const service = createMockService();
    const controller = new SystemConfigController(service as never);
    service.testConnectivity.mockResolvedValue({ success: true, message: 'OK', timestamp: '' });

    const result = await controller.test(mockAdmin, 'AI_OLLAMA_BASE_URL');

    expect(result.success).toBe(true);
    expect(service.testConnectivity).toHaveBeenCalledWith('AI_OLLAMA_BASE_URL', mockAdmin);
  });
});
