import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { HouseholdMembershipGuard } from '../household-membership.guard';

type RequestLike = {
  user?: { id: string };
  params?: Record<string, string>;
};

type AuthServiceLike = {
  getMembership: ReturnType<typeof vi.fn>;
};

function buildContext(user?: RequestLike['user'], params: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
  } as unknown as ExecutionContext;
}

describe('HouseholdMembershipGuard (Mandantentrennung)', () => {
  it('denies access to a foreign household without a membership entry', async () => {
    const authService: AuthServiceLike = {
      getMembership: vi.fn().mockResolvedValue(null),
    };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext({ id: 'user-a' }, { householdId: 'household-b' });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Isolation');
    expect(authService.getMembership).toHaveBeenCalledWith('user-a', 'household-b');
  });

  it('allows access with an existing membership in the target household', async () => {
    const authService: AuthServiceLike = {
      getMembership: vi.fn().mockResolvedValue({ householdId: 'household-a', userId: 'user-a' }),
    };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext({ id: 'user-a' }, { householdId: 'household-a' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows requests without a householdId param unchanged', async () => {
    const authService: AuthServiceLike = { getMembership: vi.fn() };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext({ id: 'user-a' }, {});

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authService.getMembership).not.toHaveBeenCalled();
  });

  it('denies access without an authenticated user', async () => {
    const authService: AuthServiceLike = { getMembership: vi.fn() };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext(undefined, { householdId: 'household-a' });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Not authenticated');
  });
});
