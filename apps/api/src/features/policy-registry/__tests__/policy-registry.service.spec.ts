import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyRegistryService } from '../policy-registry.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';
import { AuthService } from '../../identity/auth.service';
import { PortalConnectorRegistry } from '../../portal-connectors/portal-connector-registry';
import { PortalConnectorService } from '../../portal-connectors/portal-connector.service';
import { experimentalMailboxSyncPlugin } from '../../portal-connectors/experimental-mailbox.plugin';

/**
 * Fake encryption port: reversible roundtrip (base64 with prefix), so tests
 * can verify "no plain text in the DB" and decryptability without having to
 * configure real AES keys.
 */
function createFakeEncryption() {
  const encrypt = vi.fn(async (plain: string) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`);
  const decrypt = vi.fn(async (cipher: string) => {
    const match = /^enc:(.+)$/.exec(cipher);
    if (!match) throw new Error('Invalid cipher format');
    return Buffer.from(match[1], 'base64').toString('utf8');
  });
  return { encrypt, decrypt };
}

function createPortalConnectorService() {
  // Like the module (OnModuleInit): register the experimental plugin so the
  // tests can verify the degradation rule.
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
    it('creates a policy and logs an audit event', async () => {
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

    it('refuses creation without household membership', async () => {
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
    it('returns only non-archived policies', async () => {
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
    it('throws NotFoundException when the policy is missing', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(service.findOne(householdId, user, 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('returns the policy with all relations', async () => {
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
    it('updates a policy and logs an audit', async () => {
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

  describe('remove (archive)', () => {
    it('archives a policy and logs an audit', async () => {
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
    it('permanently deletes a policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.insurancePolicy.delete.mockResolvedValue({ id: policyId });

      const result = await service.hardDelete(householdId, userId, policyId);

      expect(result.success).toBe(true);
      expect(mockDb.insurancePolicy.delete).toHaveBeenCalledWith({ where: { id: policyId } });
    });
  });

  describe('Covered Persons', () => {
    it('adds a covered person with audit', async () => {
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

    it('removes a covered person', async () => {
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
    it('creates a portal link with audit and deeplink enrichment', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(makeLink());

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
      });

      expect(result.providerKey).toBe('huk-coburg');
      // The deeplink is resolved from the catalog (core scope).
      expect(result.deepLinkUrl).toBe('https://meine.huk.de/');
      // Catalog and connector views are enriched.
      expect(result.catalog?.displayName).toBe('HUK-COBURG');
      expect(result.catalog?.accessHint).toBeTruthy();
      expect(result.credentialsSet).toBe(false);
      // No cipher/plain-text field in the response.
      expect(result).not.toHaveProperty('credentialsEncrypted');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityType: 'PortalAccountLink', action: 'CREATE' }),
        }),
      );
    });

    it('stores credentials encrypted and never in plain text', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(
        makeLink({ credentialsEncrypted: await encryption.encrypt(JSON.stringify({ portalUsername: 'max', portalPassword: 'secret' })) }),
      );

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        credentials: { portalUsername: 'max', portalPassword: 'secret' },
      });

      // The DB receives exclusively the cipher, never plain text.
      const createCall = mockDb.portalAccountLink.create.mock.calls[0][0] as {
        data: { credentialsEncrypted: string | null };
      };
      expect(createCall.data.credentialsEncrypted).toBeTruthy();
      expect(createCall.data.credentialsEncrypted).not.toContain('max');
      expect(createCall.data.credentialsEncrypted).not.toContain('secret');

      // Roundtrip: after decryption the values are identically present.
      const decrypted = JSON.parse(
        await encryption.decrypt(createCall.data.credentialsEncrypted as string),
      );
      expect(decrypted).toEqual({ portalUsername: 'max', portalPassword: 'secret' });

      // The response only contains credentialsSet, never the values.
      expect(result.credentialsSet).toBe(true);
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(JSON.stringify(result)).not.toContain('portalPassword');
    });

    it('audits credential changes redacted (without values)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(makeLink());

      await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        credentials: { portalUsername: 'max', portalPassword: 'super-secret' },
      });

      const auditData = mockDb.auditEvent.create.mock.calls[0][0] as { data: { diffJson: unknown } };
      const serialized = JSON.stringify(auditData.data.diffJson);
      expect(serialized).not.toContain('super-secret');
      expect(serialized).not.toContain('portalPassword');
      expect(auditData.data.diffJson).toEqual(
        expect.objectContaining({ providerKey: 'huk-coburg', credentialsSet: true }),
      );
    });

    it('rejects empty credentials (no dead record)', async () => {
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

    it('deletes credentials when credentials: null', async () => {
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

    it('update replaces credentials completely (replace semantics)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.findFirst.mockResolvedValue(
        makeLink({ credentialsEncrypted: 'enc:alt-user' }),
      );
      mockDb.portalAccountLink.update.mockResolvedValue(makeLink({ credentialsEncrypted: 'enc:neu' }));

      await service.updatePortalLink(householdId, userId, policyId, 'pl-1', {
        credentials: { portalPassword: 'password-only' },
      });

      const updateCall = mockDb.portalAccountLink.update.mock.calls[0][0] as {
        data: { credentialsEncrypted: string | null };
      };
      const decrypted = JSON.parse(
        await encryption.decrypt(updateCall.data.credentialsEncrypted as string),
      );
      // Only the submitted field is present – no old username.
      expect(decrypted).toEqual({ portalPassword: 'password-only' });
    });

    it('an unavailable connector does not impair the portal link', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      // connectorKey points to a registered but DEACTIVATED plugin.
      mockDb.portalAccountLink.create.mockResolvedValue(
        makeLink({ connectorKey: 'mailbox-sync-browser-automation' }),
      );

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        connectorKey: 'mailbox-sync-browser-automation',
      });

      // The portal link still works (deeplink present).
      expect(result.deepLinkUrl).toBe('https://meine.huk.de/');
      // The connector is visible but marked as deactivated.
      expect(result.connector).not.toBeNull();
      expect(result.connector?.available).toBe(false);
      expect(result.connector?.experimental).toBe(true);
    });

    it('unknown connector key yields no connector view but an intact link', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, contractNumber: 'HUK-123' });
      mockDb.portalAccountLink.create.mockResolvedValue(makeLink({ connectorKey: 'unknown-plugin' }));

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'huk-coburg',
        connectorKey: 'unknown-plugin',
      });

      expect(result.connector).toBeNull();
      expect(result.deepLinkUrl).toBe('https://meine.huk.de/');
      expect(result.catalog?.displayName).toBe('HUK-COBURG');
    });
  });

  describe('Dashboard Pinning (BugFix-06, part 4)', () => {
    it('pin sets pinnedAt and logs an audit event', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.insurancePolicy.update.mockResolvedValue({
        id: policyId,
        pinnedAt: new Date('2026-08-05T12:00:00.000Z'),
      });

      const result = await service.pin(householdId, userId, policyId);

      const updateCall = mockDb.insurancePolicy.update.mock.calls[0][0] as {
        data: { pinnedAt: Date | null };
      };
      expect(updateCall.data.pinnedAt).toBeInstanceOf(Date);
      expect(result.pinnedAt).toEqual(new Date('2026-08-05T12:00:00.000Z'));
      const auditData = mockDb.auditEvent.create.mock.calls[0][0] as {
        data: { action: string; diffJson: { pinnedAt: string } };
      };
      expect(auditData.data.action).toBe('PIN');
      expect(auditData.data.diffJson.pinnedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('unpin sets pinnedAt to null and logs an audit event', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({
        id: policyId,
        householdId,
        pinnedAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      mockDb.insurancePolicy.update.mockResolvedValue({ id: policyId, pinnedAt: null });

      const result = await service.unpin(householdId, userId, policyId);

      const updateCall = mockDb.insurancePolicy.update.mock.calls[0][0] as {
        data: { pinnedAt: null };
      };
      expect(updateCall.data.pinnedAt).toBeNull();
      expect(result.pinnedAt).toBeNull();
      const auditData = mockDb.auditEvent.create.mock.calls[0][0] as {
        data: { action: string };
      };
      expect(auditData.data.action).toBe('UNPIN');
    });

    it('pin/unpin throw NotFoundException for foreign policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(service.pin(householdId, userId, policyId)).rejects.toThrow(NotFoundException);
      await expect(service.unpin(householdId, userId, policyId)).rejects.toThrow(NotFoundException);
      expect(mockDb.insurancePolicy.update).not.toHaveBeenCalled();
    });

    it('findPinned returns only pinned policies, newest first', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: policyId,
          contractNumber: 'POL-123',
          portalLinks: [],
          coveredPersons: [],
          pinnedAt: new Date('2026-08-05T00:00:00.000Z'),
        },
        {
          id: 'policy-2',
          contractNumber: 'POL-2',
          portalLinks: [],
          coveredPersons: [],
          pinnedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.findPinned(householdId, user);

      expect(result).toHaveLength(2);
      const findManyCall = mockDb.insurancePolicy.findMany.mock.calls[0][0] as {
        where: { pinnedAt: { not: null } };
        orderBy: { pinnedAt: string };
      };
      expect(findManyCall.where.pinnedAt).toEqual({ not: null });
      expect(findManyCall.orderBy).toEqual({ pinnedAt: 'desc' });
    });

    it('findPinned denies access to foreign households', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(service.findPinned('household-foreign', user)).rejects.toThrow(ForbiddenException);
      expect(mockDb.insurancePolicy.findMany).not.toHaveBeenCalled();
    });
  });
});
