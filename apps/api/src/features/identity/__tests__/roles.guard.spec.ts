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

  it('allows access when the global role is included in the requirement', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.USER, GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.USER));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ADMIN access to USER routes', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.USER] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.ADMIN));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies access when the role is not sufficient (USER vs ADMIN)', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.USER));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Role is not sufficient');
  });

  it('denies READ_ONLY access to write routes (only USER/ADMIN)', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.USER, GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.READ_ONLY));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows READ_ONLY access to read-only routes', () => {
    const reflector = {
      getAllAndOverride: () => [GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.READ_ONLY));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when no roles are required', () => {
    const reflector = { getAllAndOverride: () => [] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(makeUser(GlobalRole.READ_ONLY));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when no user is attached to the request', () => {
    const reflector = { getAllAndOverride: () => [GlobalRole.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = buildContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow('Not authenticated');
  });

  it.each([
    [GlobalRole.READ_ONLY, [GlobalRole.USER, GlobalRole.ADMIN], false],
    [GlobalRole.USER, [GlobalRole.USER, GlobalRole.ADMIN], true],
    [GlobalRole.ADMIN, [GlobalRole.ADMIN], true],
    [GlobalRole.ADMIN, [GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN], true],
  ])('role %s against requirement %j -> allowed=%s', (userRole, required, expected) => {
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
