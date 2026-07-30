import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, normalizeIdentifier } from '../auth.service';
import { UserStatus, HouseholdRole } from '@prisma/client';

function createMockDb() {
  return {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    credential: {
      findUnique: vi.fn(),
    },
    householdMembership: {
      findUnique: vi.fn(),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
}

type MockDb = ReturnType<typeof createMockDb>;

function createMockPasswordHashing() {
  return {
    hash: vi.fn(),
    verify: vi.fn(),
  };
}

type MockPasswordHashing = ReturnType<typeof createMockPasswordHashing>;

describe('normalizeIdentifier', () => {
  it('wandelt in Kleinbuchstaben um', () => {
    expect(normalizeIdentifier('Benutzer')).toBe('benutzer');
  });

  it('entfernt fuehrende/folgende Leerzeichen', () => {
    expect(normalizeIdentifier('  user  ')).toBe('user');
  });

  it('kombiniert Trimmen und Lowercase', () => {
    expect(normalizeIdentifier('  Max Mustermann  ')).toBe('max mustermann');
  });

  it('behandelt leeren String', () => {
    expect(normalizeIdentifier('')).toBe('');
  });
});

describe('AuthService.upsertFromOidcClaims', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
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

describe('AuthService.localLogin', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  const activeUser = {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    status: UserStatus.ACTIVE,
    memberships: [{ householdId: 'h1', role: HouseholdRole.MEMBER }],
  };

  const mockCredential = {
    id: 'cred-1',
    userId: 'user-1',
    identifier: 'testuser',
    passwordHash: '$2b$12$hash',
    user: activeUser,
  };

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
  });

  it('gibt AuthenticatedUser bei korrekten Anmeldedaten zurueck', async () => {
    mockDb.credential.findUnique.mockResolvedValue(mockCredential);
    mockPasswordHashing.verify.mockResolvedValue(true);

    const result = await service.localLogin('TestUser ', 'richtiges-passwort');

    expect(result).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      status: UserStatus.ACTIVE,
      memberships: [{ householdId: 'h1', role: 'MEMBER' }],
    });
    expect(mockDb.credential.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identifier: 'testuser' },
      }),
    );
  });

  it('gibt null bei falschem Passwort zurueck (generic)', async () => {
    mockDb.credential.findUnique.mockResolvedValue(mockCredential);
    mockPasswordHashing.verify.mockResolvedValue(false);

    const result = await service.localLogin('TestUser', 'falsches-passwort');
    expect(result).toBeNull();
  });

  it('gibt null bei unbekanntem Identifier zurueck (generic)', async () => {
    mockDb.credential.findUnique.mockResolvedValue(null);

    const result = await service.localLogin('unbekannt', 'passwort');
    expect(result).toBeNull();
  });

  it('gibt null bei deaktiviertem Benutzer zurueck', async () => {
    mockDb.credential.findUnique.mockResolvedValue({
      ...mockCredential,
      user: { ...activeUser, status: UserStatus.DISABLED },
    });

    const result = await service.localLogin('testuser', 'passwort');
    expect(result).toBeNull();
  });

  it('normalisiert den Identifier vor der Suche', async () => {
    mockDb.credential.findUnique.mockResolvedValue(null);

    await service.localLogin('  Grossbuchstabe  ', 'passwort');

    expect(mockDb.credential.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identifier: 'grossbuchstabe' },
      }),
    );
  });
});

describe('AuthService.findCredentialByIdentifier', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
  });

  it('findet Credential nach normalisiertem Identifier', async () => {
    mockDb.credential.findUnique.mockResolvedValue({
      userId: 'user-1',
      identifier: 'testuser',
    });

    const result = await service.findCredentialByIdentifier('  TestUser  ');
    expect(result).toEqual({ userId: 'user-1', identifier: 'testuser' });
  });

  it('gibt null bei nicht gefundenem Identifier', async () => {
    mockDb.credential.findUnique.mockResolvedValue(null);
    const result = await service.findCredentialByIdentifier('unbekannt');
    expect(result).toBeNull();
  });
});
