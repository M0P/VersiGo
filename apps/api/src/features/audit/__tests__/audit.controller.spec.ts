import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole, UserStatus } from '@prisma/client';
import { AuditController } from '../audit.controller';
import { ROLES_KEY } from '../../identity/roles.decorator';
import { RolesGuard } from '../../identity/roles.guard';

type ServiceLike = {
  listEvents: ReturnType<typeof vi.fn>;
  getEvent: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return { listEvents: vi.fn(), getEvent: vi.fn() };
}

describe('AuditController', () => {
  it('fordert auf Controller-Ebene die ADMIN-Rolle an', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AuditController);
    expect(roles).toContain(GlobalRole.ADMIN);
  });

  it('verweigert nicht-ADMIN-Rollen (USER/READ_ONLY) den Zugriff mit 403', () => {
    const required = Reflect.getMetadata(ROLES_KEY, AuditController);
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

  it('listEvents delegiert an den Service', async () => {
    const service = createMockService();
    const controller = new AuditController(service as never);
    const expected = { events: [], total: 0 };
    service.listEvents.mockResolvedValue(expected);
    const query = { take: 25 };

    const result = await controller.listEvents(query as never);

    expect(result).toEqual(expected);
    expect(service.listEvents).toHaveBeenCalledWith(query);
  });

  it('getEvent delegiert an den Service', async () => {
    const service = createMockService();
    const controller = new AuditController(service as never);
    const expected = { id: 'e1', diffJson: null };
    service.getEvent.mockResolvedValue(expected);

    const result = await controller.getEvent('e1');

    expect(result).toEqual(expected);
    expect(service.getEvent).toHaveBeenCalledWith('e1');
  });
});
