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
    // Opaquer, bcrypt-artiger Hash, der den Klartext niemals enthaelt.
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

  it('legt den initialen Admin an, wenn kein Benutzername existiert', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    service = createService(createMockConfig());

    await service.bootstrap();

    // Benutzername wird normalisiert (lowercase, getrimmt)
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
    // AP-16: credentials hat kein identifier-Feld mehr
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
    // Audit-Eintrag fuer den Bootstrap
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
    // Nur der Hash wird gespeichert, niemals der Klartext
    expect(mockPasswordHashing.hash).toHaveBeenCalledWith('local-dev-admin-pw-2026');
    const credentialData = tx.credential.create.mock.calls[0][0].data;
    expect(credentialData.passwordHash).toBe(
      '$2b$12$mockhash0000000000000000000000000000000000000000000000000',
    );
    expect(credentialData.passwordHash).not.toContain('local-dev-admin-pw-2026');
    expect(credentialData.passwordHash).not.toBe('local-dev-admin-pw-2026');
    expect(tx.user.create.mock.calls[0][0].data).not.toHaveProperty('passwordHash');
  });

  it('legt kein Duplikat an, wenn der Admin bereits existiert', async () => {
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

  it('stellt das Default-Household auch bei bereits existierendem Admin sicher (Upgrade-Reparatur)', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    // Kein neuer Admin, keine Credential-Erstellung ...
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.credential.create).not.toHaveBeenCalled();
    // ... aber das Household + die Mitgliedschaft werden idempotent repariert
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

  it('auditiert die Mitgliedschaft auch im Reparaturpfad, wenn das Household bereits existiert', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    mockDb._tx.household.findUnique.mockResolvedValue({ id: 'default' });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    // Bestehendes Household wird nicht neu angelegt ...
    expect(tx.household.create).not.toHaveBeenCalled();
    const householdAudits = tx.auditEvent.create.mock.calls.filter(
      (call) => call[0].data.action === 'BOOTSTRAP_DEFAULT_HOUSEHOLD',
    );
    expect(householdAudits).toHaveLength(0);
    // ... aber die neu angelegte Mitgliedschaft wird auditiert
    expect(tx.householdMembership.upsert).toHaveBeenCalled();
    const membershipAudits = tx.auditEvent.create.mock.calls.filter(
      (call) => call[0].data.action === 'BOOTSTRAP_DEFAULT_HOUSEHOLD_MEMBERSHIP',
    );
    expect(membershipAudits).toHaveLength(1);
    expect(membershipAudits[0][0].data.entityId).toBe('default');
    expect(membershipAudits[0][0].data.actorUserId).toBe('user-1');
  });

  it('vergibt keine Default-Household-Mitgliedschaft an einen bestehenden Nicht-ADMIN', async () => {
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

  it('ist idempotent: ein zweiter Bootstrap legt kein zweites Household an', async () => {
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
    // Mitgliedschaft wurde beim ersten Lauf angelegt, beim zweiten nicht erneut
    expect(membershipAudits).toHaveLength(1);
  });

  it('ueberschreibt ein bestehendes Passwort nicht, wenn sich die Konfiguration aendert', async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: GlobalRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    service = createService(
      createMockConfig({ LOCAL_ADMIN_PASSWORD: 'neues-passwort-nach-erstem-start' }),
    );

    await service.bootstrap();

    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
    expect(mockPasswordHashing.hash).not.toHaveBeenCalled();
  });

  it('fuehrt in Produktion keinen Bootstrap aus, wenn lokale Auth nicht explizit aktiviert ist', async () => {
    service = createService(
      createMockConfig({ isProduction: true, LOCAL_AUTH_ENABLED: false }),
    );

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('fuehrt in Produktion den Bootstrap aus, wenn lokale Auth und Admin-Variablen explizit gesetzt sind', async () => {
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

  it('verweigert in Produktion den Bootstrap mit dem .env.example-Platzhalter-Passwort', async () => {
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

  it('erlaubt in Entwicklung/Test weiterhin den Bootstrap mit dem Platzhalter-Passwort', async () => {
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

  it('fuehrt keinen Bootstrap aus, wenn lokale Auth deaktiviert ist', async () => {
    service = createService(createMockConfig({ LOCAL_AUTH_ENABLED: false }));

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('ueberspringt den Bootstrap, wenn Admin-Variablen fehlen', async () => {
    service = createService(
      createMockConfig({ LOCAL_ADMIN_USERNAME: undefined, LOCAL_ADMIN_PASSWORD: undefined }),
    );

    await service.bootstrap();

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('wirft nicht, wenn der Benutzername bereits vergeben ist (P2002, Race zwischen Replikas)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const conflict = new Error('Unique constraint failed on the fields: (`username`)');
    (conflict as { code?: string }).code = 'P2002';
    mockDb._tx.user.create.mockRejectedValueOnce(conflict);
    service = createService(createMockConfig());

    await expect(service.bootstrap()).resolves.toBeUndefined();

    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
  });

  it('wirft bei Nicht-Duplikat-Fehlern (z. B. DB nicht erreichbar) nicht, loggt aber', async () => {
    const dbError = new Error('Can\'t reach database server');
    (dbError as { code?: string }).code = 'P1001';
    mockDb.user.findUnique.mockRejectedValueOnce(dbError);
    service = createService(createMockConfig());

    await expect(service.bootstrap()).resolves.toBeUndefined();
  });

  it('normalisiert den Benutzernamen (lowercase, getrimmt)', async () => {
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
