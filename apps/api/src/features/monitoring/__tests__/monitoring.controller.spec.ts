import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole, UserStatus } from '@prisma/client';
import { MonitoringController } from '../monitoring.controller';
import { ROLES_KEY } from '../../identity/roles.decorator';
import { RolesGuard } from '../../identity/roles.guard';

type ServiceLike = {
  queueOverview: ReturnType<typeof vi.fn>;
  listFailedJobs: ReturnType<typeof vi.fn>;
  retryFailedJob: ReturnType<typeof vi.fn>;
  aiJobs: ReturnType<typeof vi.fn>;
  integrations: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    queueOverview: vi.fn(),
    listFailedJobs: vi.fn(),
    retryFailedJob: vi.fn(),
    aiJobs: vi.fn(),
    integrations: vi.fn(),
  };
}

describe('MonitoringController', () => {
  it('fordert auf Controller-Ebene die ADMIN-Rolle an', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, MonitoringController);
    expect(roles).toContain(GlobalRole.ADMIN);
  });

  it('verweigert nicht-ADMIN-Rollen (USER/READ_ONLY) den Zugriff mit 403', () => {
    const required = Reflect.getMetadata(ROLES_KEY, MonitoringController);
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    for (const role of [GlobalRole.USER, GlobalRole.READ_ONLY]) {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              id: 'user-1',
              username: 'u',
              displayName: 'U',
              role,
              status: UserStatus.ACTIVE,
              memberships: [],
            },
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    }
  });

  it('queues delegiert an den Service', async () => {
    const service = createMockService();
    const controller = new MonitoringController(service as never);
    const expected = [{ queue: 'ai-extraction', waiting: 0 }];
    service.queueOverview.mockResolvedValue(expected);

    const result = await controller.queues();

    expect(result).toEqual(expected);
    expect(service.queueOverview).toHaveBeenCalledOnce();
  });

  it('failedJobs delegiert an den Service', async () => {
    const service = createMockService();
    const controller = new MonitoringController(service as never);
    const expected = [{ id: '42', name: 'extract' }];
    service.listFailedJobs.mockResolvedValue(expected);

    const result = await controller.failedJobs();

    expect(result).toEqual(expected);
  });

  it('retryFailedJob delegiert mit der Job-ID', async () => {
    const service = createMockService();
    const controller = new MonitoringController(service as never);
    service.retryFailedJob.mockResolvedValue({ retried: true });

    await controller.retryFailedJob('42');

    expect(service.retryFailedJob).toHaveBeenCalledWith('42');
  });

  it('aiJobs delegiert an den Service', async () => {
    const service = createMockService();
    const controller = new MonitoringController(service as never);
    const expected = { statusCounts: {}, recent: [] };
    service.aiJobs.mockResolvedValue(expected);

    const result = await controller.aiJobs();

    expect(result).toEqual(expected);
  });

  it('integrations delegiert an den Service', async () => {
    const service = createMockService();
    const controller = new MonitoringController(service as never);
    const expected = { ai: { enabled: false }, paperless: { enabled: false } };
    service.integrations.mockResolvedValue(expected);

    const result = await controller.integrations();

    expect(result).toEqual(expected);
  });
});
