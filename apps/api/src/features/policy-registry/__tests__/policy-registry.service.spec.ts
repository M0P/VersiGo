import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyRegistryService } from '../policy-registry.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';
import { AuthService } from '../../identity/auth.service';
import { PortalConnectorRegistry } from '../../portal-connectors/portal-connector-registry';
import { PortalConnectorService } from '../../portal-connectors/portal-connector.service';
import { experimentalMailboxSyncPlugin } from '../../portal-connectors/experimental-mailbox.plugin';

/**
 * Fake-EncryptionPort: reversibler Roundtrip (base64 mit Praefix), damit
 * Tests "nicht Klartext in der DB" und Entschluesselbarkeit pruefen koennen,
 * ohne echte AES-Schluessel konfigurieren zu muessen.
 */
function createFakeEncryption() {
  const encrypt = vi.fn(async (plain: string) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`);
  const decrypt = vi.fn(async (cipher: string) => {
    const match = /^enc:(.+)$/.exec(cipher);
    if (!match) throw new Error('Ungueltiges Chiffrat-Format');
    return Buffer.from(match[1], 'base64').toString('utf8');
  });
  return { encrypt, decrypt };
}

function createPortalConnectorService() {
  // Wie das Modul (OnModuleInit): das experimentelle Plugin registrieren,
  // damit Tests die Degradations-Regel pruefen koennen.
  const registry = new PortalConnectorRegistry();
  registry.register(experimentalMailboxSyncPlugin);
  return new PortalConnectorService(registry);
}

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    coveredPerson: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    portalAccountLink: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    coveredPerson: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    portalAccountLink: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

type MockDb = ReturnType<typeof createMockDb>;

describe('PolicyRegistryService', () => {
  let mockDb: MockDb;
  let service: PolicyRegistryService;
  let encryption: ReturnType<typeof createFakeEncryption>;
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';

  function makeLink(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pl-1',
      policyId,
      providerKey: 'huk-coburg',
      portalUrl: null,
      accessHint: null,
      usernameHint: null,
      connectorKey: null,
      mailboxCapability: false,
      lastSyncAt: null,
      syncStatus: 'PENDING',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      credentialsEncrypted: null,
      ...overrides,
    };
  }

  const user = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };

  beforeEach(() => {
    mockDb = createMockDb();
    encryption = createFakeEncryption();
    service = new PolicyRegistryService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
      encryption as never,
      createPortalConnectorService() as never,
    );
  });

  describe('create', () => {
    it('erstellt eine Policy und protokolliert Audit-Ereignis', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.create.mockResolvedValue({
        id: policyId,
        householdId,
        ownerUserId: userId,
        type: 'HAFTPFLICHT',
        insurerName: 'Test AG',
        contractNumber: 'POL-123',
        status: 'ACTIVE',
        startDate: new Date('2025-01-01'),
        source: 'MANUAL',
        coveredPersons: [],
        costEntries: [],
        documents: [],
        portalLinks: [],
      });

      const result = await service.create(householdId, userId, {
        type: 'HAFTPFLICHT',
        insurerName: 'Test AG',
        contractNumber: 'POL-123',
        startDate: '2025-01-01',
      });

      expect(result.insurerName).toBe('Test AG');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'InsurancePolicy',
            action: 'CREATE',
          }),
        }),
      );
    });

    it('verweigert Erstellung ohne Household-Mitgliedschaft', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, {
          type: 'HAFTPFLICHT',
          insurerName: 'Test AG',
          contractNumber: 'POL-123',
          startDate: '2025-01-01',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('gibt nur nicht-archivierte Policies zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        { id: 'p1', householdId, coveredPersons: [], portalLinks: [] },
        { id: 'p2', householdId, coveredPersons: [], portalLinks: [] },
      ]);

      const result = await service.findAll(householdId, user);

      expect(result).toHaveLength(2);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('wirft NotFoundException bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(service.findOne(householdId, user, 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('gibt Policy mit allen Relationen zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({
        id: policyId,
        householdId,
        coveredPersons: [{ id: 'cp1', personName: 'Max Mustermann' }],
        costEntries: [],
        documents: [],
        portalLinks: [],
      });

      const result = await service.findOne(householdId, user, policyId);

      expect(result.id).toBe(policyId);
      expect(result.coveredPersons).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('aktualisiert eine Policy und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.insurancePolicy.update.mockResolvedValue({
        id: policyId,
        insurerName: 'Neue AG',
        coveredPersons: [],
        costEntries: [],
        documents: [],
        portalLinks: [],
      });

      const result = await service.update(householdId, userId, policyId, {
        insurerName: 'Neue AG',
      });

      expect(result.insurerName).toBe('Neue AG');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE' }),
        }),
      );
    });
  });

  describe('remove (archivieren)', () => {
    it('archiviert eine Policy und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.insurancePolicy.update.mockResolvedValue({ id: policyId, archivedAt: new Date() });

      const result = await service.remove(householdId, userId, policyId);

      expect(result.success).toBe(true);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityId: policyId,
            action: 'ARCHIVE',
          }),
        }),
      );
    });
  });

  describe('hardDelete', () => {
    it('loescht eine Policy endgueltig', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.insurancePolicy.delete.mockResolvedValue({ id: policyId });

      const result = await service.hardDelete(householdId, userId, policyId);

      expect(result.success).toBe(true);
      expect(mockDb.insurancePolicy.delete).toHaveBeenCalledWith({ where: { id: policyId } });
    });
  });

  describe('Covered Persons', () => {
    it('fuegt versicherte Person hinzu mit Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.coveredPerson.create.mockResolvedValue({
        id: 'cp-1',
        policyId,
        personName: 'Maria Muster',
        relationType: 'EHEPARTNER',
      });

      const result = await service.addCoveredPerson(householdId, userId, policyId, {
        personName: 'Maria Muster',
        relationType: 'EHEPARTNER',
      });

      expect(result.personName).toBe('Maria Muster');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityType: 'CoveredPerson', action: 'CREATE' }),
        }),
      );
    });

    it('entfernt versicherte Person', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.coveredPerson.findFirst.mockResolvedValue({ id: 'cp-1', policyId });
      mockDb.coveredPerson.delete.mockResolvedValue({ id: 'cp-1' });

      const result = await service.removeCoveredPerson(householdId, userId, policyId, 'cp-1');

      expect(result.success).toBe(true);
      expect(mockDb.coveredPerson.delete).toHaveBeenCalledWith({ where: { id: 'cp-1' } });
    });
  });

  describe('Portal Account Links', () => {
    it('erstellt Portal-Link mit Audit und Deeplink-Anreicherung', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(makeLink());

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
      });

      expect(result.providerKey).toBe('huk-coburg');
      // Deeplink wird aus dem Katalog aufgeloest (Kernumfang).
      expect(result.deepLinkUrl).toBe('https://meine.huk.de/');
      // Katalog- und Connector-Sicht sind angereichert.
      expect(result.catalog?.displayName).toBe('HUK-COBURG');
      expect(result.catalog?.accessHint).toBeTruthy();
      expect(result.credentialsSet).toBe(false);
      // Kein Chiffrat-/Klartext-Feld in der Antwort.
      expect(result).not.toHaveProperty('credentialsEncrypted');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityType: 'PortalAccountLink', action: 'CREATE' }),
        }),
      );
    });

    it('speichert Credentials verschluesselt und nie im Klartext', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(
        makeLink({ credentialsEncrypted: await encryption.encrypt(JSON.stringify({ portalUsername: 'max', portalPassword: 'geheim' })) }),
      );

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        credentials: { portalUsername: 'max', portalPassword: 'geheim' },
      });

      // Die DB erhaelt ausschliesslich das Chiffrat, nie Klartext.
      const createCall = mockDb.portalAccountLink.create.mock.calls[0][0] as {
        data: { credentialsEncrypted: string | null };
      };
      expect(createCall.data.credentialsEncrypted).toBeTruthy();
      expect(createCall.data.credentialsEncrypted).not.toContain('max');
      expect(createCall.data.credentialsEncrypted).not.toContain('geheim');

      // Roundtrip: Entschluesselt sind die Werte identisch vorhanden.
      const decrypted = JSON.parse(
        await encryption.decrypt(createCall.data.credentialsEncrypted as string),
      );
      expect(decrypted).toEqual({ portalUsername: 'max', portalPassword: 'geheim' });

      // Antwort enthaelt nur credentialsSet, nie die Werte.
      expect(result.credentialsSet).toBe(true);
      expect(JSON.stringify(result)).not.toContain('geheim');
      expect(JSON.stringify(result)).not.toContain('portalPassword');
    });

    it('auditiert Credentials-Aenderungen redigiert (ohne Werte)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(makeLink());

      await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        credentials: { portalUsername: 'max', portalPassword: 'super-geheim' },
      });

      const auditData = mockDb.auditEvent.create.mock.calls[0][0] as { data: { diffJson: unknown } };
      const serialized = JSON.stringify(auditData.data.diffJson);
      expect(serialized).not.toContain('super-geheim');
      expect(serialized).not.toContain('portalPassword');
      expect(auditData.data.diffJson).toEqual(
        expect.objectContaining({ providerKey: 'huk-coburg', credentialsSet: true }),
      );
    });

    it('lehnt leere Credentials ab (kein toter Datensatz)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });

      await expect(
        service.createPortalLink(householdId, userId, policyId, {
          providerKey: 'huk-coburg',
          credentials: {},
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.portalAccountLink.create).not.toHaveBeenCalled();
    });

    it('loescht Credentials bei credentials: null', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.findFirst.mockResolvedValue(makeLink({ credentialsEncrypted: 'enc:abc' }));
      mockDb.portalAccountLink.update.mockResolvedValue(makeLink({ credentialsEncrypted: null }));

      const result = await service.updatePortalLink(householdId, userId, policyId, 'pl-1', {
        credentials: null,
      });

      const updateCall = mockDb.portalAccountLink.update.mock.calls[0][0] as {
        data: { credentialsEncrypted: string | null };
      };
      expect(updateCall.data.credentialsEncrypted).toBeNull();
      expect(result.credentialsSet).toBe(false);
      const auditData = mockDb.auditEvent.create.mock.calls[0][0] as { data: { diffJson: unknown } };
      expect(auditData.data.diffJson).toEqual(expect.objectContaining({ credentialsSet: false }));
    });

    it('Update ersetzt Zugangsdaten vollstaendig (Replace-Semantik)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.findFirst.mockResolvedValue(
        makeLink({ credentialsEncrypted: 'enc:alt-user' }),
      );
      mockDb.portalAccountLink.update.mockResolvedValue(makeLink({ credentialsEncrypted: 'enc:neu' }));

      await service.updatePortalLink(householdId, userId, policyId, 'pl-1', {
        credentials: { portalPassword: 'nur-passwort' },
      });

      const updateCall = mockDb.portalAccountLink.update.mock.calls[0][0] as {
        data: { credentialsEncrypted: string | null };
      };
      const decrypted = JSON.parse(
        await encryption.decrypt(updateCall.data.credentialsEncrypted as string),
      );
      // Nur das uebermittelte Feld ist enthalten – kein Alt-Benutzername.
      expect(decrypted).toEqual({ portalPassword: 'nur-passwort' });
    });

    it('nicht verfuegbarer Connector beeintraechtigt den Portal-Link nicht', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      // connectorKey verweist auf ein registriertes, aber DEAKTIVIERTES Plugin.
      mockDb.portalAccountLink.create.mockResolvedValue(
        makeLink({ connectorKey: 'mailbox-sync-browser-automation' }),
      );

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        connectorKey: 'mailbox-sync-browser-automation',
      });

      // Der Portal-Link funktioniert weiterhin (Deeplink vorhanden).
      expect(result.deepLinkUrl).toBe('https://meine.huk.de/');
      // Der Connector ist sichtbar, aber als deaktiviert markiert.
      expect(result.connector).not.toBeNull();
      expect(result.connector?.available).toBe(false);
      expect(result.connector?.experimental).toBe(true);
    });

    it('unbekannter Connector-Schluessel ergibt keine Connector-Sicht, aber intakten Link', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(makeLink({ connectorKey: 'unbekanntes-plugin' }));

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        connectorKey: 'unbekanntes-plugin',
      });

      expect(result.connector).toBeNull();
      expect(result.deepLinkUrl).toBe('https://meine.huk.de/');
      expect(result.catalog?.displayName).toBe('HUK-COBURG');
    });
  });
});
