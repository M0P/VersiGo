import { describe, it, expect } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';
import { HouseholdRole } from '@prisma/client';

type RequestLike = {
  user?: {
    id?: string;
    memberships: { householdId: string; role: HouseholdRole }[];
  };
  params?: Record<string, string>;
  body?: Record<string, string>;
};

function buildContext(
  user: RequestLike['user'],
  params: Record<string, string> = {},
  body: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params, body }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const householdId = 'household-a';

  const makeUser = (role: HouseholdRole) => ({
    id: 'user-1',
    memberships: [{ householdId, role }],
  });

  it('erlaubt Zugriff wenn Rolle ausreicht (OWNER erfuellt ADMIN-Anforderung)', () => {
    const reflector = { getAllAndOverride: () => [HouseholdRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(HouseholdRole.OWNER), { householdId });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('verweigert Zugriff wenn Rolle nicht ausreicht (VIEWER vs ADMIN)', () => {
    const reflector = { getAllAndOverride: () => [HouseholdRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(HouseholdRole.VIEWER), { householdId });
    expect(() => guard.canActivate(ctx)).toThrow('Rolle reicht');
  });

  it('verweigert Zugriff ohne Membership im Ziel-Household', () => {
    const reflector = { getAllAndOverride: () => [HouseholdRole.MEMBER] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(HouseholdRole.OWNER), { householdId: 'household-b' });
    expect(() => guard.canActivate(ctx)).toThrow('Kein Zugriff');
  });

  it('erlaubt Zugriff wenn keine Rollen gefordert sind', () => {
    const reflector = { getAllAndOverride: () => [] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(HouseholdRole.VIEWER), { householdId });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it.each([
    [HouseholdRole.MEMBER, HouseholdRole.MEMBER, true],
    [HouseholdRole.MEMBER, HouseholdRole.VIEWER, true],
    [HouseholdRole.ADMIN, HouseholdRole.MEMBER, true],
  ])('Rolle %s gegen Anforderung %s -> erlaubt=%s', (userRole, required, expected) => {
    const reflector = { getAllAndOverride: () => [required] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(userRole), { householdId });
    if (expected) {
      expect(guard.canActivate(ctx)).toBe(true);
    } else {
      expect(() => guard.canActivate(ctx)).toThrow();
    }
  });
});
