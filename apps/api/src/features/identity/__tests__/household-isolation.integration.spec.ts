import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../auth.service';
import { HouseholdMembershipGuard } from '../household-membership.guard';

type MembershipRecord = {
  householdId: string;
  userId: string;
};

function createMockDb(memberships: MembershipRecord[]) {
  return {
    user: {
      findUnique: vi.fn(),
    },
    householdMembership: {
      findUnique: vi.fn(
        ({ where }: { where: { householdId_userId: { householdId: string; userId: string } } }) =>
          Promise.resolve(
            memberships.find(
              (m) =>
                m.householdId === where.householdId_userId.householdId &&
                m.userId === where.householdId_userId.userId,
            ) ?? null,
          ),
      ),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
}

describe('Household-Isolation (Integration)', () => {
  const householdA = 'household-aaaa';
  const householdB = 'household-bbbb';
  const userA = { id: 'user-aaaa', householdId: householdA };
  const userB = { id: 'user-bbbb', householdId: householdB };

  let guard: HouseholdMembershipGuard;

  beforeEach(() => {
    const memberships: MembershipRecord[] = [
      { householdId: householdA, userId: userA.id },
      { householdId: householdB, userId: userB.id },
    ];
    const mockDb = createMockDb(memberships);
    const authService = new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never);
    guard = new HouseholdMembershipGuard(authService);
  });

  function contextFor(userId: string, householdId: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: userId }, params: { householdId } }),
      }),
    } as const;
  }

  it('User A erhaelt Zugriff auf eigenes Household A', async () => {
    await expect(guard.canActivate(contextFor(userA.id, householdA) as never)).resolves.toBe(true);
  });

  it('User A wird von Household B abgewiesen (Isolation)', async () => {
    await expect(guard.canActivate(contextFor(userA.id, householdB) as never)).rejects.toThrow('Isolation');
  });

  it('User B wird von Household A abgewiesen (Isolation, symmetrisch)', async () => {
    await expect(guard.canActivate(contextFor(userB.id, householdA) as never)).rejects.toThrow('Isolation');
  });

  it('User B erhaelt Zugriff auf eigenes Household B', async () => {
    await expect(guard.canActivate(contextFor(userB.id, householdB) as never)).resolves.toBe(true);
  });
});
