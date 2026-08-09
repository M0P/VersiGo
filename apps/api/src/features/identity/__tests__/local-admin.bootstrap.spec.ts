import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalAdminBootstrapService } from '../local-admin.bootstrap';
import { GlobalRole, UserStatus } from '@prisma/client';

function createMockTx() {
  return {
    user: {
      create: vi.fn().mockResolvedValue({ id: 'user-1' }),
    },
    credential: {
      create: vi.fn().mockResolvedValue({ id: 'cred-1' }),
    },
    household: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'default' }),
      upsert: vi.fn().mockResolvedValue({ id: 'default' }),
    },
    householdMembership: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'membership-1' }),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

function createMockDb() {
  const tx = createMockTx();
  return {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(
      async (fn: (tx: MockTx) => Promise<void>) => fn(tx),
    ),
    _tx: tx,
  };
}

type MockDb = ReturnType<typeof createMockDb>;

function createMockConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    isProduction: false,
    LOCAL_AUTH_ENABLED: true,
    LOCAL_ADMIN_USERNAME: 'LocalAdmin',
    LOCAL_ADMIN_PASSWORD: 'local-dev-admin-pw-2026',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => values[key]),
    isProduction: values.isProduction,
  };
}

function createMockPasswordHashing() {
  return {
    // Opaque, bcrypt-like hash that never contains the plain text.
    hash: vi.fn(async () => '$2b$12$mockhash0000000000000000000000000000000000000000000000000'),
    verify: vi.fn(),
  };
}

describe('LocalAdminBootstrapService', () => {
  let mockDb: MockDb;
  let mockPasswordHashing: ReturnType<typeof createMockPasswordHashing>;
  let service: LocalAdminBootstrapService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockPasswordHashing = createMockPasswordHashing();
  });

  function createService(config: ReturnType<typeof createMockConfig>) {
    return new LocalAdminBootstrapService(
      mockDb as never,
      config as never,
      mockPasswordHashing as never,
    );
  }

  it('creates the initial admin when no username exists', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    service = createService(createMockConfig());

    await service.bootstrap();

    // The username is normalized (lowercase, trimmed)
    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'localadmin' },
      select: { id: true, role: true, status: true },
    });

    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'localadmin',
        displayName: 'localadmin',
        role: GlobalRole.ADMIN,
        status: UserStatus.ACTIVE,
      }),
    });
    expect(tx.credential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: expect.any(String) as string,
      }),
    });
    // AP-16: credentials no longer has an identifier field
    expect(tx.credential.create.mock.calls[0][0].data).not.toHaveProperty('identifier');
    // AP-20: Beta-Referenz-Household "default" + Admin-Mitgliedschaft anlegen
    expect(tx.household.findUnique).toHaveBeenCalledWith({
      where: { id: 'default' },
      select: { id: true },
    });
    expect(tx.household.create).toHaveBeenCalledWith({
      data: { id: 'default', name: 'Default Household' },
    });
    expect(tx.householdMembership.upsert).toHaveBeenCalledWith({
      where: {
        householdId_userId: { householdId: 'default', userId: 'user-1' },
      },
      create: { householdId: 'default', userId: 'user-1' },
      update: {},
    });
    // Audit entry for the bootstrap
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'User',
        action: 'BOOTSTRAP_ADMIN',
      }),
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Household',
        action: 'BOOTSTRAP_DEFAULT_HOUSEHOLD',
        entityId: 'default',
      }),
    });
    // Only the hash is stored, never the plain text
    expect(mockPasswordHashing.hash).toHaveBeenCalledWith('local-dev-admin-pw-2026');
    const credentialData = tx.credential.create.mock.calls[0][0].data;
    expect(credentialData.passwordHash).toBe(
      '$2b$12$mockhash0000000000000000000000000000000000000000000000000',
    );
    expect(credentialData.passwordHash).not.toContain('local-dev-admin-pw-2026');
    expect(credentialData.passwordHash).not.toBe('local-dev-admin-pw-2026');
    expect(tx.user.create.mock.calls[0][0].data).not.toHaveProperty('passwordHash');
  });

  it('does not create a duplicate when the admin already exists', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.credential.create).not.toHaveBeenCalled();
    expect(mockPasswordHashing.hash).not.toHaveBeenCalled();
  });

  it('ensures the default household even when the admin already exists (upgrade repair)', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    // No new admin, no credential creation ...
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.credential.create).not.toHaveBeenCalled();
    // ... but the household + membership are repaired idempotently
    expect(tx.household.findUnique).toHaveBeenCalledWith({
      where: { id: 'default' },
      select: { id: true },
    });
    expect(tx.household.create).toHaveBeenCalledWith({
      data: { id: 'default', name: 'Default Household' },
    });
    expect(tx.householdMembership.upsert).toHaveBeenCalledWith({
      where: {
        householdId_userId: { householdId: 'default', userId: 'user-1' },
      },
      create: { householdId: 'default', userId: 'user-1' },
      update: {},
    });
  });

  it('audits the membership in the repair path too when the household already exists', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    mockDb._tx.household.findUnique.mockResolvedValue({ id: 'default' });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    // An existing household is not recreated ...
    expect(tx.household.create).not.toHaveBeenCalled();
    const householdAudits = tx.auditEvent.create.mock.calls.filter(
      (call) => call[0].data.action === 'BOOTSTRAP_DEFAULT_HOUSEHOLD',
    );
    expect(householdAudits).toHaveLength(0);
    // ... but the newly created membership is audited
    expect(tx.householdMembership.upsert).toHaveBeenCalled();
    const membershipAudits = tx.auditEvent.create.mock.calls.filter(
      (call) => call[0].data.action === 'BOOTSTRAP_DEFAULT_HOUSEHOLD_MEMBERSHIP',
    );
    expect(membershipAudits).toHaveLength(1);
    expect(membershipAudits[0][0].data.entityId).toBe('default');
    expect(membershipAudits[0][0].data.actorUserId).toBe('user-1');
  });

  it('does not grant a default household membership to an existing non-ADMIN', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.USER,
      status: UserStatus.ACTIVE,
    });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    expect(tx.household.create).not.toHaveBeenCalled();
    expect(tx.householdMembership.upsert).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a second bootstrap does not create a second household', async () => {
    mockDb.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'user-1',
        role: GlobalRole.ADMIN,
        status: UserStatus.ACTIVE,
      });
    mockDb._tx.household.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'default' });
    mockDb._tx.householdMembership.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ householdId: 'default' });
    service = createService(createMockConfig());

    await service.bootstrap();
    await service.bootstrap();

    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.household.create).toHaveBeenCalledTimes(1);
    const householdAudits = tx.auditEvent.create.mock.calls.filter(
      (call) => call[0].data.action === 'BOOTSTRAP_DEFAULT_HOUSEHOLD',
    );
    expect(householdAudits).toHaveLength(1);
    const membershipAudits = tx.auditEvent.create.mock.calls.filter(
      (call) => call[0].data.action === 'BOOTSTRAP_DEFAULT_HOUSEHOLD_MEMBERSHIP',
    );
    // The membership was created on the first run, not again on the second
    expect(membershipAudits).toHaveLength(1);
  });

  it('does not overwrite an existing password when the configuration changes', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    service = createService(
      createMockConfig({ LOCAL_ADMIN_PASSWORD: 'new-password-after-first-start' }),
    );

    await service.bootstrap();

    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
    expect(mockPasswordHashing.hash).not.toHaveBeenCalled();
  });

  it('does not run the bootstrap in production when local auth is not explicitly enabled', async () => {
    service = createService(
      createMockConfig({ isProduction: true, LOCAL_AUTH_ENABLED: false }),
    );

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('runs the bootstrap in production when local auth and admin variables are explicitly set', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    service = createService(
      createMockConfig({
        isProduction: true,
        LOCAL_AUTH_ENABLED: true,
        LOCAL_ADMIN_USERNAME: 'prodadmin',
        LOCAL_ADMIN_PASSWORD: 'prod-admin-pw-2026-strong',
      }),
    );

    await service.bootstrap();

    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'prodadmin',
        role: GlobalRole.ADMIN,
        status: UserStatus.ACTIVE,
      }),
    });
    expect(tx.household.create).toHaveBeenCalledWith({
      data: { id: 'default', name: 'Default Household' },
    });
    expect(tx.householdMembership.upsert).toHaveBeenCalled();
  });

  it('refuses the bootstrap in production with the .env.example placeholder password', async () => {
    service = createService(
      createMockConfig({
        isProduction: true,
        LOCAL_AUTH_ENABLED: true,
        LOCAL_ADMIN_USERNAME: 'prodadmin',
        LOCAL_ADMIN_PASSWORD: 'CHANGE_ME_FOR_LOCAL_DEVELOPMENT',
      }),
    );

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
    expect(mockDb._tx.household.create).not.toHaveBeenCalled();
  });

  it('still allows the bootstrap in development/test with the placeholder password', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    service = createService(
      createMockConfig({
        isProduction: false,
        LOCAL_AUTH_ENABLED: true,
        LOCAL_ADMIN_USERNAME: 'localadmin',
        LOCAL_ADMIN_PASSWORD: 'CHANGE_ME_FOR_LOCAL_DEVELOPMENT',
      }),
    );

    await service.bootstrap();

    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.household.create).toHaveBeenCalled();
    expect(tx.householdMembership.upsert).toHaveBeenCalled();
  });

  it('does not run the bootstrap when local auth is disabled', async () => {
    service = createService(createMockConfig({ LOCAL_AUTH_ENABLED: false }));

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('skips the bootstrap when admin variables are missing', async () => {
    service = createService(
      createMockConfig({ LOCAL_ADMIN_USERNAME: undefined, LOCAL_ADMIN_PASSWORD: undefined }),
    );

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('does not throw when the username is already taken (P2002, race between replicas)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const conflict = new Error('Unique constraint failed on the fields: (`username`)');
    (conflict as { code?: string }).code = 'P2002';
    mockDb._tx.user.create.mockRejectedValueOnce(conflict);
    service = createService(createMockConfig());

    await expect(service.bootstrap()).resolves.toBeUndefined();

    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
  });

  it('does not throw on non-duplicate errors (e.g. DB unreachable) but logs', async () => {
    const dbError = new Error('Can\'t reach database server');
    (dbError as { code?: string }).code = 'P1001';
    mockDb.user.findUnique.mockRejectedValueOnce(dbError);
    service = createService(createMockConfig());

    await expect(service.bootstrap()).resolves.toBeUndefined();
  });

  it('normalizes the username (lowercase, trimmed)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    service = createService(
      createMockConfig({ LOCAL_ADMIN_USERNAME: '  LocalAdmin  ' }),
    );

    await service.bootstrap();

    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'localadmin' },
      select: { id: true, role: true, status: true },
    });
    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'localadmin',
        displayName: 'localadmin',
      }),
    });
  });
});
