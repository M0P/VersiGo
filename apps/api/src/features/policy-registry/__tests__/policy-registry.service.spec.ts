import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyRegistryService } from '../policy-registry.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

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
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';

  beforeEach(() => {
    mockDb = createMockDb();
    service = new PolicyRegistryService(mockDb as never);
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

      const result = await service.findAll(householdId, userId);

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

      await expect(service.findOne(householdId, userId, 'nonexistent')).rejects.toThrow(NotFoundException);
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

      const result = await service.findOne(householdId, userId, policyId);

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
    it('erstellt Portal-Link mit Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.portalAccountLink.create.mockResolvedValue({
        id: 'pl-1',
        policyId,
        providerKey: 'test-provider',
        syncStatus: 'PENDING',
      });

      const result = await service.createPortalLink(householdId, userId, policyId, {
        providerKey: 'test-provider',
      });

      expect(result.providerKey).toBe('test-provider');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityType: 'PortalAccountLink', action: 'CREATE' }),
        }),
      );
    });
  });
});
