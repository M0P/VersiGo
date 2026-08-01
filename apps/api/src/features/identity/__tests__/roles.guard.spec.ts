import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';
import { GlobalRole, UserStatus } from '@prisma/client';

type RequestLike = {
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: GlobalRole;
    status: UserStatus;
    memberships: { householdId: string }[];
  };
};

function buildContext(user: RequestLike['user']): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const makeUser = (role: GlobalRole) => ({
    id: 'user-1',
    username: 'u',
    displayName: 'U',
    role,
    status: UserStatus.ACTIVE,
    memberships: [],
  });

  it('erlaubt Zugriff wenn die globale Rolle in der Anforderung enthalten ist', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.USER, GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.USER));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('erlaubt ADMIN Zugriff auf USER-Routen', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.USER] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.ADMIN));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('verweigert Zugriff wenn die Rolle nicht ausreicht (USER vs ADMIN)', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.USER));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Rolle reicht');
  });

  it('verweigert READ_ONLY Zugriff auf Schreib-Routen (nur USER/ADMIN)', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.USER, GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.READ_ONLY));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('erlaubt READ_ONLY Zugriff auf reine Leserouten', () => {
    const reflector = {
      getAllAndOverride: () => [GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.READ_ONLY));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('erlaubt Zugriff wenn keine Rollen gefordert sind', () => {
    const reflector = { getAllAndOverride: () => [] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.READ_ONLY));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('wirft ForbiddenException wenn kein User am Request haengt', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow('Nicht authentifiziert');
  });

  it.each([
    [GlobalRole.READ_ONLY, [GlobalRole.USER, GlobalRole.ADMIN], false],
    [GlobalRole.USER, [GlobalRole.USER, GlobalRole.ADMIN], true],
    [GlobalRole.ADMIN, [GlobalRole.ADMIN], true],
    [GlobalRole.ADMIN, [GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN], true],
  ])('Rolle %s gegen Anforderung %j -> erlaubt=%s', (userRole, required, expected) => {
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(userRole));
    if (expected) {
      expect(guard.canActivate(ctx)).toBe(true);
    } else {
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    }
  });
});
