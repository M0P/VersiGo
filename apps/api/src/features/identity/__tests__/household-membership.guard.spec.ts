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
  it('verweigert Zugriff auf fremdes Household ohne Membership-Eintrag', async () => {
    const authService: AuthServiceLike = {
      getMembership: vi.fn().mockResolvedValue(null),
    };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext({ id: 'user-a' }, { householdId: 'household-b' });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Isolation');
    expect(authService.getMembership).toHaveBeenCalledWith('user-a', 'household-b');
  });

  it('erlaubt Zugriff bei bestehender Membership im Ziel-Household', async () => {
    const authService: AuthServiceLike = {
      getMembership: vi.fn().mockResolvedValue({ householdId: 'household-a', userId: 'user-a', role: 'MEMBER' }),
    };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext({ id: 'user-a' }, { householdId: 'household-a' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('erlaubt Requests ohne householdId-Param unverändert', async () => {
    const authService: AuthServiceLike = { getMembership: vi.fn() };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext({ id: 'user-a' }, {});

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authService.getMembership).not.toHaveBeenCalled();
  });

  it('verweigert Zugriff ohne authentifizierten User', async () => {
    const authService: AuthServiceLike = { getMembership: vi.fn() };
    const guard = new HouseholdMembershipGuard(authService as never);
    const ctx = buildContext(undefined, { householdId: 'household-a' });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Nicht authentifiziert');
  });
});
