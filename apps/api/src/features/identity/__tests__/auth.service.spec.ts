import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth.service';
import { UserStatus, HouseholdRole } from '@prisma/client';

type DbMock = {
  client: {
    user: { upsert: ReturnType<typeof vi.fn> };
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
  };
};

describe('AuthService.upsertFromOidcClaims', () => {
  let dbMock: DbMock;
  let service: AuthService;

  beforeEach(() => {
    dbMock = {
      client: {
        user: { upsert: vi.fn() },
        householdMembership: { findUnique: vi.fn() },
      },
    };
    service = new AuthService(dbMock as never);
  });

  it('upserted User anhand (oidcIssuer, oidcSubject), niemals oidcSubject allein', async () => {
    dbMock.client.user.upsert.mockResolvedValue({
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

    expect(dbMock.client.user.upsert).toHaveBeenCalledWith(
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
    dbMock.client.user.upsert.mockResolvedValue({
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
    dbMock.client.user.upsert.mockResolvedValue({
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
      locale: 'de-DE',
    });

    const callArg = dbMock.client.user.upsert.mock.calls[0][0];
    expect(callArg.where.oidcIssuer_oidcSubject.oidcIssuer).toBe('https://issuer-b.example.com');
  });
});
