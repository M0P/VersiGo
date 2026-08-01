import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuthService,
  normalizeIdentifier,
  USERNAME_REGEX,
} from '../auth.service';
import { GlobalRole, UserStatus, ObjectSharePermission, ObjectShareScopeType } from '@prisma/client';

function createMockDb() {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    credential: {
      create: vi.fn(),
    },
    householdMembership: {
      findUnique: vi.fn(),
    },
    objectShare: {
      findMany: vi.fn(),
    },
    insurancePolicy: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    $transaction: vi.fn(),
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

describe('USERNAME_REGEX', () => {
  it('erlaubt 3-32 Zeichen aus [a-z0-9._-] mit alphanumerischem Start', () => {
    expect(USERNAME_REGEX.test('max')).toBe(true);
    expect(USERNAME_REGEX.test('max.muster_2')).toBe(true);
    expect(USERNAME_REGEX.test('a1-b2.c3')).toBe(true);
  });

  it('lehnt ungueltige Benutzernamen ab', () => {
    expect(USERNAME_REGEX.test('ab')).toBe(false); // zu kurz
    expect(USERNAME_REGEX.test('-max')).toBe(false); // Start mit Sonderzeichen
    expect(USERNAME_REGEX.test('max m')).toBe(false); // Leerzeichen
    expect(USERNAME_REGEX.test('Max')).toBe(false); // Grossbuchstaben
    expect(USERNAME_REGEX.test('x'.repeat(33))).toBe(false); // zu lang
  });
});

describe('AuthService.registerLocalAccount', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
    mockPasswordHashing.hash.mockResolvedValue('$2b$12$hash');
    // $transaction(cb) => cb(tx); tx === mockDb (Bereitstellung)
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockDb));
  });

  it('erstellt PENDING_APPROVAL-Konto, Credential und Audit-Eintrag (ohne Passwort im Audit)', async () => {
    mockDb.user.create.mockResolvedValue({ id: 'user-1' });

    const result = await service.registerLocalAccount({
      username: '  Max  ',
      displayName: 'Max Muster',
      password: 'ein-langes-passwort',
    });

    expect(result).toEqual({ id: 'user-1' });
    expect(mockPasswordHashing.hash).toHaveBeenCalledWith('ein-langes-passwort');
    expect(mockDb.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'max',
          displayName: 'Max Muster',
          role: GlobalRole.USER,
          status: UserStatus.PENDING_APPROVAL,
        }),
      }),
    );
    expect(mockDb.credential.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', passwordHash: '$2b$12$hash' },
    });
    const auditCall = mockDb.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe('REGISTER_PENDING');
    // Kein Passwort, kein Hash, kein Benutzername-Klartext im Audit
    expect(JSON.stringify(auditCall.data)).not.toContain('ein-langes-passwort');
    expect(JSON.stringify(auditCall.data)).not.toContain('$2b$12$hash');
  });

  it('wirft ConflictException bei bereits vergebenem Benutzernamen (P2002)', async () => {
    mockDb.user.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.registerLocalAccount({
        username: 'max',
        displayName: 'Max',
        password: 'ein-langes-passwort',
      }),
    ).rejects.toThrow('Benutzername ist bereits vergeben');
  });
});

describe('AuthService.findByOidcIdentity', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
  });

  it('sucht ueber (oidcIssuer, oidcSubject) und liefert den User', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'max',
      displayName: 'Max Muster',
      role: GlobalRole.USER,
      status: UserStatus.ACTIVE,
      memberships: [{ householdId: 'h1' }],
    });

    const result = await service.findByOidcIdentity('https://issuer.example.com', 'sub-123');

    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: {
        oidcIssuer_oidcSubject: {
          oidcIssuer: 'https://issuer.example.com',
          oidcSubject: 'sub-123',
        },
      },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      id: 'user-1',
      username: 'max',
      displayName: 'Max Muster',
      role: GlobalRole.USER,
      status: UserStatus.ACTIVE,
      memberships: [{ householdId: 'h1' }],
    });
  });

  it('gibt null bei ungebundener Identitaet zurueck (kein Provisioning)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const result = await service.findByOidcIdentity('https://issuer.example.com', 'sub-999');
    expect(result).toBeNull();
  });

  it('gibt null bei nicht aktivem Konto zurueck (PENDING_APPROVAL/DISABLED)', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'max',
      displayName: 'Max',
      role: GlobalRole.USER,
      status: UserStatus.PENDING_APPROVAL,
      memberships: [],
    });
    const result = await service.findByOidcIdentity('https://issuer.example.com', 'sub-123');
    expect(result).toBeNull();
  });
});

describe('AuthService.localLogin', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  const activeUser = {
    id: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [{ householdId: 'h1' }],
    credential: { passwordHash: '$2b$12$hash' },
  };

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
  });

  it('gibt AuthenticatedUser bei korrekten Anmeldedaten zurueck', async () => {
    mockDb.user.findUnique.mockResolvedValue(activeUser);
    mockPasswordHashing.verify.mockResolvedValue(true);

    const result = await service.localLogin('TestUser ', 'richtiges-passwort');

    expect(result).toEqual({
      id: 'user-1',
      username: 'testuser',
      displayName: 'Test User',
      role: GlobalRole.USER,
      status: UserStatus.ACTIVE,
      memberships: [{ householdId: 'h1' }],
    });
    // Normalisierung: lowercase + trim
    expect(mockDb.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'testuser' } }),
    );
  });

  it('gibt null bei falschem Passwort zurueck (generic)', async () => {
    mockDb.user.findUnique.mockResolvedValue(activeUser);
    mockPasswordHashing.verify.mockResolvedValue(false);

    const result = await service.localLogin('testuser', 'falsches-passwort');
    expect(result).toBeNull();
  });

  it('gibt null bei unbekanntem Benutzernamen zurueck (generic)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const result = await service.localLogin('unbekannt', 'passwort');
    expect(result).toBeNull();
  });

  it('gibt null bei nicht aktivem Benutzer zurueck (generic, auch PENDING_APPROVAL)', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: UserStatus.PENDING_APPROVAL,
    });

    const result = await service.localLogin('testuser', 'passwort');
    expect(result).toBeNull();
    expect(mockPasswordHashing.verify).not.toHaveBeenCalled();
  });

  it('gibt null bei Konto ohne Credential zurueck', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...activeUser,
      credential: null,
    });

    const result = await service.localLogin('testuser', 'passwort');
    expect(result).toBeNull();
  });
});

describe('AuthService.assertPolicyReadAccess', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
  });

  it('laesst USER/ADMIN mit Mitgliedschaft lesen', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId: 'h1', userId: 'user-1' });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1' });

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.USER, status: UserStatus.ACTIVE, memberships: [{ householdId: 'h1' }] },
        'h1',
        'policy-1',
      ),
    ).resolves.toBeUndefined();
    // Kein ObjectShare-Zugriff fuer USER
    expect(mockDb.objectShare.findMany).not.toHaveBeenCalled();
  });

  it('blockt ohne Household-Mitgliedschaft (Isolation)', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue(null);

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.USER, status: UserStatus.ACTIVE, memberships: [] },
        'fremd-household',
        'policy-1',
      ),
    ).rejects.toThrow('Isolation');
  });

  it('blockt READ_ONLY ohne explizite READ-Freigabe', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId: 'h1', userId: 'user-1' });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1' });
    mockDb.objectShare.findMany.mockResolvedValue([]);

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.READ_ONLY, status: UserStatus.ACTIVE, memberships: [{ householdId: 'h1' }] },
        'h1',
        'policy-1',
      ),
    ).rejects.toThrow('Keine Lese-Freigabe');
  });

  it('laesst READ_ONLY mit expliziter INSURANCE-READ-Freigabe lesen', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId: 'h1', userId: 'user-1' });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1' });
    mockDb.objectShare.findMany.mockResolvedValue([
      { scopeType: ObjectShareScopeType.INSURANCE, scopeRef: 'policy-1', sourceUserId: 'owner-1' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1' });

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.READ_ONLY, status: UserStatus.ACTIVE, memberships: [{ householdId: 'h1' }] },
        'h1',
        'policy-1',
      ),
    ).resolves.toBeUndefined();
  });
});

describe('AuthService.getReadablePolicyIds', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
  });

  it('liefert null fuer USER/ADMIN (alle Policies des Households)', async () => {
    const result = await service.getReadablePolicyIds(
      { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.USER, status: UserStatus.ACTIVE, memberships: [] },
      'h1',
    );
    expect(result).toBeNull();
    expect(mockDb.objectShare.findMany).not.toHaveBeenCalled();
  });

  it('liefert freigegebene Policy-IDs fuer READ_ONLY', async () => {
    mockDb.objectShare.findMany.mockResolvedValue([
      { scopeType: ObjectShareScopeType.INSURANCE, scopeRef: 'policy-1', sourceUserId: 'owner-1' },
      { scopeType: ObjectShareScopeType.ALL_OWNED, scopeRef: null, sourceUserId: 'owner-2' },
    ]);
    mockDb.insurancePolicy.findMany.mockResolvedValue([
      { id: 'policy-1' },
      { id: 'policy-2' },
    ]);

    const result = await service.getReadablePolicyIds(
      { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.READ_ONLY, status: UserStatus.ACTIVE, memberships: [] },
      'h1',
    );
    expect(result).toEqual(['policy-1', 'policy-2']);
    // READ-Freigabe wird verlangt
    expect(mockDb.objectShare.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          permission: ObjectSharePermission.READ,
          targetUserId: 'user-1',
        }),
      }),
    );
  });

  it('liefert leere Liste ohne jegliche Freigabe', async () => {
    mockDb.objectShare.findMany.mockResolvedValue([]);
    const result = await service.getReadablePolicyIds(
      { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.READ_ONLY, status: UserStatus.ACTIVE, memberships: [] },
      'h1',
    );
    expect(result).toEqual([]);
  });
});
