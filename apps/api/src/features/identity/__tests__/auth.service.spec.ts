import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth.service';
import { UserStatus, HouseholdRole } from '@prisma/client';

function createMockDb() {
  return {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    householdMembership: {
      findUnique: vi.fn(),
    },
  };
}

type MockDb = ReturnType<typeof createMockDb>;

describe('AuthService.upsertFromOidcClaims', () => {
  let mockDb: MockDb;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new AuthService(mockDb as never);
  });

  it('upserted User anhand (oidcIssuer, oidcSubject), niemals oidcSubject allein', async () => {
    mockDb.user.upsert.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      status: UserStatus.ACTIVE,
      memberships: [{ householdId: 'h1', role: HouseholdRole.MEMBER }],
    });

    await service.upsertFromOidcClaims({
      oidcIssuer: 'https://issuer-a.example.com',
      oidcSubject: 'sub-123',
      email: 'test@example.com',
      displayName: 'Test User',
      locale: 'de-DE',
    });

    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          oidcIssuer_oidcSubject: {
            oidcIssuer: 'https://issuer-a.example.com',
            oidcSubject: 'sub-123',
          },
        },
      }),
    );
  });

  it('mappt Memberships aus dem User-Ergebnis korrekt', async () => {
    mockDb.user.upsert.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      status: UserStatus.ACTIVE,
      memberships: [
        { householdId: 'h1', role: HouseholdRole.OWNER },
        { householdId: 'h2', role: HouseholdRole.VIEWER },
      ],
    });

    const result = await service.upsertFromOidcClaims({
      oidcIssuer: 'https://issuer-a.example.com',
      oidcSubject: 'sub-123',
      email: 'test@example.com',
      displayName: 'Test User',
      locale: 'de-DE',
    });

    expect(result.memberships).toEqual([
      { householdId: 'h1', role: HouseholdRole.OWNER },
      { householdId: 'h2', role: HouseholdRole.VIEWER },
    ]);
  });

  it('gleiches oidcSubject bei unterschiedlichem Issuer erzeugt getrennte Lookups', async () => {
    mockDb.user.upsert.mockResolvedValue({
      id: 'user-2',
      email: 'other@example.com',
      displayName: 'Other User',
      status: UserStatus.ACTIVE,
      memberships: [],
    });

    await service.upsertFromOidcClaims({
      oidcIssuer: 'https://issuer-b.example.com',
      oidcSubject: 'sub-123',
      email: 'other@example.com',
      displayName: 'Other User',
      locale: 'en-US',
    });

    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          oidcIssuer_oidcSubject: {
            oidcIssuer: 'https://issuer-b.example.com',
            oidcSubject: 'sub-123',
          },
        },
      }),
    );
  });
});
