import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalAdminBootstrapService } from '../local-admin.bootstrap';
import { UserStatus } from '@prisma/client';

function createMockTx() {
  return {
    user: {
      create: vi.fn().mockResolvedValue({ id: 'user-1' }),
    },
    credential: {
      create: vi.fn().mockResolvedValue({ id: 'cred-1' }),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

function createMockDb() {
  const tx = createMockTx();
  return {
    credential: {
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
    LOCAL_ADMIN_EMAIL: 'Admin@Local.Test',
    LOCAL_ADMIN_PASSWORD: 'local-dev-admin-pw-2026',
    LOCAL_ADMIN_FIRST_NAME: 'Local',
    LOCAL_ADMIN_LAST_NAME: 'Admin',
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

  it('legt den initialen Admin an, wenn kein Credential existiert', async () => {
    mockDb.credential.findUnique.mockResolvedValue(null);
    service = createService(createMockConfig());

    await service.bootstrap();

    // Identifier wird normalisiert (lowercase, getrimmt)
    expect(mockDb.credential.findUnique).toHaveBeenCalledWith({
      where: { identifier: 'admin@local.test' },
      select: { id: true },
    });

    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'Admin@Local.Test',
        displayName: 'Local Admin',
        oidcIssuer: 'local',
        oidcSubject: 'admin@local.test',
        status: UserStatus.ACTIVE,
      }),
    });
    expect(tx.credential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identifier: 'admin@local.test',
        userId: expect.any(String) as string,
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
    mockDb.credential.findUnique.mockResolvedValue({ id: 'cred-1' });
    service = createService(createMockConfig());

    await service.bootstrap();

    const tx = mockDb._tx;
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.credential.create).not.toHaveBeenCalled();
    expect(mockPasswordHashing.hash).not.toHaveBeenCalled();
  });

  it('ueberschreibt ein bestehendes Passwort nicht, wenn sich die Konfiguration aendert', async () => {
    mockDb.credential.findUnique.mockResolvedValue({ id: 'cred-1' });
    service = createService(
      createMockConfig({ LOCAL_ADMIN_PASSWORD: 'neues-passwort-nach-erstem-start' }),
    );

    await service.bootstrap();

    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
    expect(mockPasswordHashing.hash).not.toHaveBeenCalled();
  });

  it('fuehrt in Produktion keinen Bootstrap aus', async () => {
    service = createService(createMockConfig({ isProduction: true }));

    await service.bootstrap();

    expect(mockDb.credential.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('fuehrt keinen Bootstrap aus, wenn lokale Auth deaktiviert ist', async () => {
    service = createService(createMockConfig({ LOCAL_AUTH_ENABLED: false }));

    await service.bootstrap();

    expect(mockDb.credential.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('ueberspringt den Bootstrap, wenn Admin-Variablen fehlen', async () => {
    service = createService(
      createMockConfig({ LOCAL_ADMIN_EMAIL: undefined, LOCAL_ADMIN_PASSWORD: undefined }),
    );

    await service.bootstrap();

    expect(mockDb.credential.findUnique).not.toHaveBeenCalled();
    expect(mockDb._tx.user.create).not.toHaveBeenCalled();
  });

  it('behandelt fehlenden Vornamen/Nachnamen ohne Absturz', async () => {
    mockDb.credential.findUnique.mockResolvedValue(null);
    service = createService(
      createMockConfig({
        LOCAL_ADMIN_FIRST_NAME: undefined,
        LOCAL_ADMIN_LAST_NAME: undefined,
      }),
    );

    await service.bootstrap();

    const tx = mockDb._tx;
    // displayName faellt auf die E-Mail zurueck
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ displayName: 'Admin@Local.Test' }),
    });
  });

  it('wirft nicht, wenn die E-Mail bereits vergeben ist (P2002, z. B. durch OIDC-Benutzer)', async () => {
    // findUnique findet kein LOCAL-Credential, aber users.email ist UNIQUE
    // und wird von einem bestehenden (OIDC-)Benutzer gehalten.
    mockDb.credential.findUnique.mockResolvedValue(null);
    const conflict = new Error(
      'Unique constraint failed on the fields: (`email`)',
    );
    (conflict as { code?: string }).code = 'P2002';
    mockDb._tx.user.create.mockRejectedValueOnce(conflict);
    service = createService(createMockConfig());

    // Muss geloggt und uebersprungen werden – nie einen Throw ausloesen.
    await expect(service.bootstrap()).resolves.toBeUndefined();

    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
  });

  it('wirft nicht bei einer Check-then-Insert-Race zwischen Replikas (P2002)', async () => {
    // Beide Replikas lesen "kein Credential vorhanden" und inserten dann –
    // die UNIQUE-Constraint schlaegt fuer den zweiten Schlag zu.
    mockDb.credential.findUnique.mockResolvedValue(null);
    const conflict = new Error(
      'Unique constraint failed on the fields: (`identifier`)',
    );
    (conflict as { code?: string }).code = 'P2002';
    mockDb._tx.user.create.mockRejectedValueOnce(conflict);
    service = createService(createMockConfig());

    await expect(service.bootstrap()).resolves.toBeUndefined();

    expect(mockDb._tx.credential.create).not.toHaveBeenCalled();
  });

  it('wirft bei Nicht-Duplikat-Fehlern (z. B. DB nicht erreichbar) nicht, loggt aber', async () => {
    const dbError = new Error('Can\'t reach database server');
    (dbError as { code?: string }).code = 'P1001';
    mockDb.credential.findUnique.mockRejectedValueOnce(dbError);
    service = createService(createMockConfig());

    await expect(service.bootstrap()).resolves.toBeUndefined();
  });

  it('speichert die E-Mail getrimmt und normalisiert den Identifier', async () => {
    mockDb.credential.findUnique.mockResolvedValue(null);
    service = createService(
      createMockConfig({ LOCAL_ADMIN_EMAIL: '  Admin@Local.Test  ' }),
    );

    await service.bootstrap();

    expect(mockDb.credential.findUnique).toHaveBeenCalledWith({
      where: { identifier: 'admin@local.test' },
      select: { id: true },
    });
    const tx = mockDb._tx;
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'Admin@Local.Test',
        displayName: 'Local Admin',
        oidcSubject: 'admin@local.test',
      }),
    });
  });
});
