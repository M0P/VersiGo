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
      update: vi.fn(),
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
  it('converts to lowercase', () => {
    expect(normalizeIdentifier('Benutzer')).toBe('benutzer');
  });

  it('removes leading/trailing whitespace', () => {
    expect(normalizeIdentifier('  user  ')).toBe('user');
  });

  it('combines trimming and lowercase', () => {
    expect(normalizeIdentifier('  Max Mustermann  ')).toBe('max mustermann');
  });

  it('behandelt leeren String', () => {
    expect(normalizeIdentifier('')).toBe('');
  });
});

describe('USERNAME_REGEX', () => {
  it('allows 3-32 characters from [a-z0-9._-] with an alphanumeric start', () => {
    expect(USERNAME_REGEX.test('max')).toBe(true);
    expect(USERNAME_REGEX.test('max.muster_2')).toBe(true);
    expect(USERNAME_REGEX.test('a1-b2.c3')).toBe(true);
  });

  it('rejects invalid usernames', () => {
    expect(USERNAME_REGEX.test('ab')).toBe(false); // too short
    expect(USERNAME_REGEX.test('-max')).toBe(false); // starts with a special character
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

  it('creates a PENDING_APPROVAL account, credential and audit entry (without the password in the audit)', async () => {
    mockDb.user.create.mockResolvedValue({ id: 'user-1' });

    const result = await service.registerLocalAccount({
      username: '  Max  ',
      displayName: 'Max Muster',
      password: 'a-long-password',
    });

    expect(result).toEqual({ id: 'user-1' });
    expect(mockPasswordHashing.hash).toHaveBeenCalledWith('a-long-password');
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
    // No password, no hash, no plain-text username in the audit
    expect(JSON.stringify(auditCall.data)).not.toContain('a-long-password');
    expect(JSON.stringify(auditCall.data)).not.toContain('$2b$12$hash');
  });

  it('throws ConflictException when the username is already taken (P2002)', async () => {
    mockDb.user.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.registerLocalAccount({
        username: 'max',
        displayName: 'Max',
        password: 'a-long-password',
      }),
    ).rejects.toThrow('Username is already taken');
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

  it('looks up by (oidcIssuer, oidcSubject) and returns the user', async () => {
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

  it('returns null for an unbound identity (no provisioning)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const result = await service.findByOidcIdentity('https://issuer.example.com', 'sub-999');
    expect(result).toBeNull();
  });

  it('returns null for a non-active account (PENDING_APPROVAL/DISABLED)', async () => {
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

describe('AuthService Self-Service-OIDC-Verknuepfung (BugFix-07)', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: MockPasswordHashing;
  let service: AuthService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
    service = new AuthService(mockDb as never, mockPasswordHashing as never);
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockDb));
  });

  describe('getOidcBinding', () => {
    it('returns the binding of the account', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        oidcIssuer: 'https://issuer.example.com',
        oidcSubject: 'sub-1',
      });

      const result = await service.getOidcBinding('user-1');
      expect(result).toEqual({
        oidcIssuer: 'https://issuer.example.com',
        oidcSubject: 'sub-1',
      });
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { oidcIssuer: true, oidcSubject: true },
      });
    });

    it('returns null without a binding', async () => {
      mockDb.user.findUnique.mockResolvedValue({ oidcIssuer: null, oidcSubject: null });
      await expect(service.getOidcBinding('user-1')).resolves.toBeNull();
    });
  });

  describe('bindOidcIdentityForUser', () => {
    it('binds the identity (normalized issuer) and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1' });

      const result = await service.bindOidcIdentityForUser(
        'user-1',
        'https://issuer.example.com/',
        'sub-1',
      );

      expect(result).toEqual({
        oidcIssuer: 'https://issuer.example.com',
        oidcSubject: 'sub-1',
      });
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { oidcIssuer: 'https://issuer.example.com', oidcSubject: 'sub-1' },
      });
      const auditCall = mockDb.auditEvent.create.mock.calls[0][0];
      expect(auditCall.data.action).toBe('OIDC_BOUND_SELF');
      expect(auditCall.data.actorUserId).toBe('user-1');
    });

    it('throws ConflictException when the identity is already bound to another account', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1' });
      mockDb.user.update.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.bindOidcIdentityForUser('user-1', 'https://issuer.example.com', 'sub-1'),
      ).rejects.toThrow('This OIDC identity is already bound to another account');
    });

    it('throws NotFoundException for an unknown user', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);
      await expect(
        service.bindOidcIdentityForUser('user-999', 'https://issuer.example.com', 'sub-1'),
      ).rejects.toThrow('User not found');
    });
  });

  describe('unbindOidcIdentityForUser', () => {
    it('removes the binding and audits OIDC_UNBOUND_SELF', async () => {
      mockDb.user.findUnique.mockResolvedValue({ oidcIssuer: 'https://issuer.example.com' });

      await service.unbindOidcIdentityForUser('user-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { oidcIssuer: null, oidcSubject: null },
      });
      const auditCall = mockDb.auditEvent.create.mock.calls[0][0];
      expect(auditCall.data.action).toBe('OIDC_UNBOUND_SELF');
    });

    it('throws ConflictException without an existing binding', async () => {
      mockDb.user.findUnique.mockResolvedValue({ oidcIssuer: null });
      await expect(service.unbindOidcIdentityForUser('user-1')).rejects.toThrow(
        'Account has no OIDC binding',
      );
    });
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

  it('returns AuthenticatedUser with correct credentials', async () => {
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

  it('returns null for a wrong password (generic)', async () => {
    mockDb.user.findUnique.mockResolvedValue(activeUser);
    mockPasswordHashing.verify.mockResolvedValue(false);

    const result = await service.localLogin('testuser', 'falsches-passwort');
    expect(result).toBeNull();
  });

  it('returns null for an unknown username (generic)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const result = await service.localLogin('unbekannt', 'passwort');
    expect(result).toBeNull();
  });

  it('returns null for a non-active user (generic, incl. PENDING_APPROVAL)', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: UserStatus.PENDING_APPROVAL,
    });

    const result = await service.localLogin('testuser', 'passwort');
    expect(result).toBeNull();
    expect(mockPasswordHashing.verify).not.toHaveBeenCalled();
  });

  it('returns null for an account without a credential', async () => {
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

  it('lets USER/ADMIN with membership read', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId: 'h1', userId: 'user-1' });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1' });

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.USER, status: UserStatus.ACTIVE, memberships: [{ householdId: 'h1' }] },
        'h1',
        'policy-1',
      ),
    ).resolves.toBeUndefined();
    // No ObjectShare access for USER
    expect(mockDb.objectShare.findMany).not.toHaveBeenCalled();
  });

  it('blocks without household membership (isolation)', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue(null);

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.USER, status: UserStatus.ACTIVE, memberships: [] },
        'fremd-household',
        'policy-1',
      ),
    ).rejects.toThrow('Isolation');
  });

  it('blocks READ_ONLY without an explicit READ share', async () => {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId: 'h1', userId: 'user-1' });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: 'policy-1' });
    mockDb.objectShare.findMany.mockResolvedValue([]);

    await expect(
      service.assertPolicyReadAccess(
        { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.READ_ONLY, status: UserStatus.ACTIVE, memberships: [{ householdId: 'h1' }] },
        'h1',
        'policy-1',
      ),
    ).rejects.toThrow('No read share');
  });

  it('lets READ_ONLY with an explicit INSURANCE-READ share read', async () => {
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

  it('returns null for USER/ADMIN (all policies of the household)', async () => {
    const result = await service.getReadablePolicyIds(
      { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.USER, status: UserStatus.ACTIVE, memberships: [] },
      'h1',
    );
    expect(result).toBeNull();
    expect(mockDb.objectShare.findMany).not.toHaveBeenCalled();
  });

  it('returns shared policy IDs for READ_ONLY', async () => {
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
    // A READ share is required
    expect(mockDb.objectShare.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          permission: ObjectSharePermission.READ,
          targetUserId: 'user-1',
        }),
      }),
    );
  });

  it('returns an empty list without any share', async () => {
    mockDb.objectShare.findMany.mockResolvedValue([]);
    const result = await service.getReadablePolicyIds(
      { id: 'user-1', username: 'u', displayName: 'U', role: GlobalRole.READ_ONLY, status: UserStatus.ACTIVE, memberships: [] },
      'h1',
    );
    expect(result).toEqual([]);
  });
});
