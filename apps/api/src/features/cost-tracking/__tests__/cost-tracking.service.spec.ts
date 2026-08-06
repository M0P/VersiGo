import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostTrackingService } from '../cost-tracking.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentFrequency, GlobalRole, UserStatus } from '@prisma/client';
import { AuthService } from '../../identity/auth.service';

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    policyCostEntry: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn(), findMany: vi.fn() },
    policyCostEntry: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

type MockDb = ReturnType<typeof createMockDb>;

describe('CostTrackingService', () => {
  let mockDb: MockDb;
  let service: CostTrackingService;
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';
  const entryId = 'entry-1';
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
    service = new CostTrackingService(
      mockDb as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
    );
  });

  describe('create', () => {
    it('erstellt eine Kostenposition und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.create.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        grossAmount: 1200,
        frequency: 'MONTHLY',
      });

      const result = await service.create(householdId, userId, policyId, {
        validFrom: '2025-01-01',
        grossAmount: 1200,
        frequency: PaymentFrequency.MONTHLY,
      });

      expect(result.id).toBe(entryId);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'PolicyCostEntry',
            action: 'CREATE',
          }),
        }),
      );
    });

    it('verweigert Erstellung ohne Household-Mitgliedschaft', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
          grossAmount: 1200,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Erstellung bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
          grossAmount: 1200,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('verweigert Erstellung bei validTo <= validFrom', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-06-01',
          validTo: '2025-01-01',
          grossAmount: 100,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('gibt alle CostEntries einer Policy zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        { id: 'e1', policyId, grossAmount: 100, frequency: 'MONTHLY' },
        { id: 'e2', policyId, grossAmount: 200, frequency: 'ANNUAL' },
      ]);

      const result = await service.findAll(householdId, user, policyId);

      expect(result).toHaveLength(2);
      expect(mockDb.policyCostEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId } }),
      );
    });
  });

  describe('findOne', () => {
    it('wirft NotFoundException bei fehlendem CostEntry', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, user, policyId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('gibt einen CostEntry zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 500,
        frequency: 'QUARTERLY',
      });

      const result = await service.findOne(householdId, user, policyId, entryId);

      expect(result.id).toBe(entryId);
    });
  });

  describe('update', () => {
    it('aktualisiert einen CostEntry und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({ id: entryId, policyId });
      mockDb.policyCostEntry.update.mockResolvedValue({
        id: entryId,
        grossAmount: 1500,
        frequency: 'MONTHLY',
      });

      const result = await service.update(householdId, userId, policyId, entryId, {
        grossAmount: 1500,
      });

      expect(result.grossAmount).toBe(1500);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE' }),
        }),
      );
    });

    it('verweigert Aktualisierung bei validTo <= validFrom', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-06-01'),
        validTo: null,
        grossAmount: 100,
        frequency: PaymentFrequency.MONTHLY,
      });

      await expect(
        service.update(householdId, userId, policyId, entryId, {
          validTo: '2025-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('loescht einen CostEntry und protokolliert Audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({ id: entryId, policyId });
      mockDb.policyCostEntry.delete.mockResolvedValue({ id: entryId });

      const result = await service.remove(householdId, userId, policyId, entryId);

      expect(result.success).toBe(true);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityId: entryId,
            action: 'DELETE',
          }),
        }),
      );
    });
  });

  describe('getAnnualCost', () => {
    it('berechnet Jahreskosten bei MONTHLY-Frequenz', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 100,
        netAmount: 90,
        frequency: 'MONTHLY',
        validFrom: new Date('2024-01-01'),
        validTo: null,
      });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result).not.toBeNull();
      expect(result!.annualGross).toBe(1200);
      expect(result!.annualNet).toBe(1080);
      expect(result!.calculationBasis.frequency).toBe('MONTHLY');
    });

    it('berechnet Jahreskosten bei ANNUAL-Frequenz', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 5000,
        netAmount: 4800,
        frequency: 'ANNUAL',
        validFrom: new Date('2024-01-01'),
        validTo: null,
      });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result!.annualGross).toBe(5000);
      expect(result!.annualNet).toBe(4800);
    });

    it('berechnet Jahreskosten bei QUARTERLY-Frequenz', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 300,
        frequency: 'QUARTERLY',
        validFrom: new Date('2024-01-01'),
        validTo: null,
      });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result!.annualGross).toBe(1200);
    });

    it('berechnet Jahreskosten bei SEMI_ANNUAL-Frequenz', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 600,
        frequency: 'SEMI_ANNUAL',
        validFrom: new Date('2024-01-01'),
        validTo: null,
      });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result!.annualGross).toBe(1200);
    });

    it('gibt null bei keinem CostEntry zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue(null);

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result).toBeNull();
    });

    it('beruecksichtigt mehrere CostEntries (aktuellster zaehlt)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: 'newer-entry',
        policyId,
        grossAmount: 200,
        frequency: 'MONTHLY',
        validFrom: new Date('2025-06-01'),
        validTo: null,
      });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result!.annualGross).toBe(2400);
      expect(result!.calculationBasis.entryId).toBe('newer-entry');
    });

    it('bevorzugt aktiven Entry vor abgelaufenem (auch bei neuerem validFrom)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: 'active-entry',
          policyId,
          grossAmount: 200,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-06-01'),
          validTo: null,
        });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result!.annualGross).toBe(2400);
      expect(result!.calculationBasis.entryId).toBe('active-entry');
      expect(mockDb.policyCostEntry.findFirst).toHaveBeenCalledTimes(1);
    });

    it('nutzt abgelaufenen Entry, wenn kein aktiver existiert', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'expired-entry',
          policyId,
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2023-01-01'),
          validTo: new Date('2023-12-31'),
        });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result!.annualGross).toBeCloseTo(1200, 0);
      expect(result!.calculationBasis.entryId).toBe('expired-entry');
    });

    it('proratiert bei unterjaehrigem CostEntry mit validTo', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        grossAmount: 1200,
        frequency: 'ANNUAL',
        validFrom: new Date('2025-07-01'),
        validTo: new Date('2025-12-31'),
      });

      const result = await service.getAnnualCost(householdId, user, policyId);

      expect(result).not.toBeNull();
      expect(result!.annualGross).toBeCloseTo(604.93, 1);
    });
  });

  describe('getYearComparison', () => {
    it('wirft BadRequestException bei NaN-Jahr', async () => {
      await expect(
        service.getYearComparison(householdId, user, policyId, NaN),
      ).rejects.toThrow(BadRequestException);
    });

    it('berechnet Vorjahresvergleich mit vorhandenen Daten', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: 'current',
          policyId,
          grossAmount: 200,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        })
        .mockResolvedValueOnce({
          id: 'previous',
          policyId,
          grossAmount: 180,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        });

      const result = await service.getYearComparison(householdId, user, policyId, 2025);

      expect(result).not.toBeNull();
      expect(result!.currentYear.annualGross).toBe(2400);
      expect(result!.previousYear!.annualGross).toBe(2160);
      expect(result!.absoluteChange).toBe(240);
      expect(result!.percentageChange).toBeCloseTo(11.11, 1);
      expect(result!.increased).toBe(true);
    });

    it('gibt null bei keinem CostEntry fuer das Jahr', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst.mockResolvedValue(null);

      const result = await service.getYearComparison(householdId, user, policyId, 2025);

      expect(result).toBeNull();
    });

    it('gibt Ergebnis ohne Vorjahresdaten', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: 'current',
          policyId,
          grossAmount: 100,
          frequency: 'ANNUAL',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        })
        .mockResolvedValueOnce(null);

      const result = await service.getYearComparison(householdId, user, policyId, 2025);

      expect(result).not.toBeNull();
      expect(result!.currentYear.annualGross).toBe(100);
      expect(result!.previousYear).toBeNull();
      expect(result!.absoluteChange).toBeNull();
    });

    it('findet naechstgelegenen Eintrag vor dem Jahr als Fallback', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'before-2024',
          policyId,
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2023-06-01'),
          validTo: new Date('2023-12-31'),
        });

      const result = await service.getYearComparison(householdId, user, policyId, 2025);

      expect(result).not.toBeNull();
      expect(result!.currentYear.annualGross).toBeCloseTo(703.56, 1);
    });

    it('setzt increased=true bei gleichen Kosten (keine Aenderung)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: 'current',
          policyId,
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        })
        .mockResolvedValueOnce({
          id: 'previous',
          policyId,
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        });

      const result = await service.getYearComparison(householdId, user, policyId, 2025);

      expect(result!.absoluteChange).toBe(0);
      expect(result!.percentageChange).toBe(0);
      expect(result!.increased).toBe(true);
    });
  });

  describe('getHouseholdSummary', () => {
    it('aggregiert Jahreskosten ueber alle Policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'HAFTPFLICHT',
          costEntries: [
            { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
        {
          id: 'p2',
          householdId,
          type: 'HAUSRAT',
          costEntries: [
            { id: 'c2', grossAmount: 500, frequency: 'ANNUAL', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(householdId, user);

      expect(result.policyCount).toBe(2);
      expect(result.totalAnnualGross).toBe(1700);
      expect(result.perType['HAFTPFLICHT']).toBe(1200);
      expect(result.perType['HAUSRAT']).toBe(500);
    });

    it('ignoriert archivierte Policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([]);

      const result = await service.getHouseholdSummary(householdId, user);

      expect(result.policyCount).toBe(0);
      expect(result.totalAnnualGross).toBe(0);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null },
        }),
      );
    });

    it('behandelt Policies ohne CostEntries', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'HAFTPFLICHT',
          costEntries: [],
        },
        {
          id: 'p2',
          householdId,
          type: 'HAUSRAT',
          costEntries: [
            { id: 'c2', grossAmount: 1000, frequency: 'ANNUAL', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(householdId, user);

      expect(result.policyCount).toBe(2);
      expect(result.totalAnnualGross).toBe(1000);
      expect(result.perType['HAFTPFLICHT']).toBe(0);
      expect(result.perType['HAUSRAT']).toBe(1000);
    });

    it('initialisiert perType fuer alle Policy-Typen, auch ohne CostEntries', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'KFZ',
          costEntries: [],
        },
      ]);

      const result = await service.getHouseholdSummary(householdId, user);

      expect(result.policyCount).toBe(1);
      expect(result.perType).toHaveProperty('KFZ');
      expect(result.perType['KFZ']).toBe(0);
    });

    it('bevorzugt aktiven vor abgelaufenem CostEntry', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'HAFTPFLICHT',
          costEntries: [
            { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2023-01-01'), validTo: new Date('2023-12-31') },
            { id: 'c2', grossAmount: 200, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(householdId, user);

      expect(result.policyCount).toBe(1);
      expect(result.totalAnnualGross).toBe(2400);
    });
  });

  describe('getPaidHistory (BugFix-06: Abrechnungsperioden seit Beginn)', () => {
    function mockMembershipAndPolicy(policy: Record<string, unknown>) {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, ...policy });
    }

    it('zahlt je begonnener Monatsperiode einen vollen Beitrag (keine Tagesanteile)', async () => {
      mockMembershipAndPolicy({
        startDate: new Date('2024-01-15'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          netAmount: null,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-15'),
          validTo: null,
        },
      ]);

      // Fixer Zeitpunkt: 3 volle Perioden begonnen (15.01., 15.02., 15.03.),
      // laufende Periode zaehlt (Beitrag faellig zu Periodenbeginn) -> 3 * 100.
      const result = await service.getPaidHistory(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.frequency).toBe('MONTHLY');
      expect(result.periods.length).toBe(3);
      expect(result.periods[0].periodLabel).toBe('01/2024');
      expect(result.periods[0].dueAmount).toBe(100);
      expect(result.periods[0].paidAmount).toBe(100);
      expect(result.periods[0].status).toBe('paid');
      expect(result.periods[1].periodLabel).toBe('02/2024');
      expect(result.periods[2].periodLabel).toBe('03/2024');
      expect(result.periods[2].status).toBe('current');
      // paidAmount == dueAmount fuer jede begonnene Periode (faellig am Beginn).
      for (const period of result.periods) {
        expect(period.paidAmount).toBe(period.dueAmount);
      }
    });

    it('nutzt die Jahresfrequenz der Versicherung (jaehrlich, 01/2024, ...)', async () => {
      mockMembershipAndPolicy({
        startDate: new Date('2024-01-01'),
        paymentFrequency: PaymentFrequency.ANNUAL,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 500,
          netAmount: null,
          frequency: 'ANNUAL',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
      ]);

      const result = await service.getPaidHistory(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.frequency).toBe('ANNUAL');
      expect(result.periods.length).toBe(1);
      expect(result.periods[0].periodLabel).toBe('01/2024');
      expect(result.periods[0].dueAmount).toBe(500);
      expect(result.periods[0].status).toBe('current');
    });

    it('beruecksichtigt Frequenzwechsel (Beitragserhoehung mid-period)', async () => {
      mockMembershipAndPolicy({
        startDate: new Date('2024-01-15'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          netAmount: null,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-15'),
          validTo: new Date('2024-06-14'),
        },
        {
          id: 'c2',
          grossAmount: 120,
          netAmount: null,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-06-15'),
          validTo: null,
        },
      ]);

      const result = await service.getPaidHistory(
        householdId,
        user,
        policyId,
        new Date('2024-08-31T12:00:00.000Z'),
      );

      expect(result.periods[0].dueAmount).toBe(100); // 01/2024
      expect(result.periods[5].periodLabel).toBe('06/2024');
      expect(result.periods[5].dueAmount).toBe(120); // neue Beitragshoehe ab 06/2024
      // Nachfolgende Perioden ebenfalls mit neuem Beitrag.
      expect(result.periods[6].dueAmount).toBe(120);
    });

    it('skaliert Eintraege, deren Frequenz von der Abrechnungsfrequenz abweicht', async () => {
      // Versicherung MONTHLY, Kosten-Eintrag QUARTERLY (300): jede Monatsperiode
      // schuldet 300/3 = 100 – Jahres-Summe bleibt konsistent (4 * 300 = 12 * 100).
      mockMembershipAndPolicy({
        startDate: new Date('2024-01-01'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 300,
          netAmount: null,
          frequency: 'QUARTERLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
      ]);

      const result = await service.getPaidHistory(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.frequency).toBe('MONTHLY');
      expect(result.periods.length).toBe(3);
      for (const period of result.periods) {
        expect(period.dueAmount).toBe(100);
        expect(period.paidAmount).toBe(100);
      }
    });

    it('realigned Perioden nach kurzen Monaten am Anker (Schaltjahr 2024)', async () => {
      // Anker 31.01.2024: +1 Monat -> 29.02.2024, +2 Monate -> 31.03.2024
      // (kein Drift auf den 29. des Folgemonats).
      mockMembershipAndPolicy({
        startDate: new Date('2024-01-31'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          netAmount: null,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-31'),
          validTo: null,
        },
      ]);

      const result = await service.getPaidHistory(
        householdId,
        user,
        policyId,
        new Date('2024-03-31T12:00:00.000Z'),
      );

      expect(result.periods.length).toBe(3);
      expect(result.periods[0].periodLabel).toBe('01/2024');
      expect(result.periods[0].periodStart).toBe('2024-01-31T00:00:00.000Z');
      expect(result.periods[1].periodLabel).toBe('02/2024');
      expect(result.periods[1].periodStart).toBe('2024-02-29T00:00:00.000Z');
      expect(result.periods[2].periodLabel).toBe('03/2024');
      expect(result.periods[2].periodStart).toBe('2024-03-31T00:00:00.000Z');
    });

    it('wirft NotFoundException bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.getPaidHistory(householdId, user, policyId),
      ).rejects.toThrow(NotFoundException);
    });

    it('liefert leere Periodenliste ohne CostEntries', async () => {
      mockMembershipAndPolicy({
        startDate: new Date('2024-01-15'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([]);

      const result = await service.getPaidHistory(householdId, user, policyId);

      expect(result.periods).toEqual([]);
      expect(result.frequency).toBe('MONTHLY');
    });
  });

  describe('getOverview paidToDate (BugFix-06: periodenbasiert)', () => {
    it('berechnet paidToDate je Abrechnungsperiode statt tagesanteilig', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({
        id: policyId,
        householdId,
        startDate: new Date('2024-01-01'),
        paymentFrequency: PaymentFrequency.MONTHLY,
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          netAmount: null,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
      ]);

      const result = await service.getOverview(householdId, user, policyId);

      expect(result).not.toBeNull();
      // Periodenbasiert: ganze Monatsbetraege (kein Tagesbruchteil).
      expect(result!.paidToDate % 100).toBe(0);
      expect(result!.paidToDate).toBeGreaterThanOrEqual(100);
      expect(mockDb.insurancePolicy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: policyId, householdId } }),
      );
    });
  });

  describe('Household-Isolation', () => {
    it('verweigert Zugriff ohne Mitgliedschaft bei findAll', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.findAll(householdId, user, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Zugriff ohne Mitgliedschaft bei getAnnualCost', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.getAnnualCost(householdId, user, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Zugriff ohne Mitgliedschaft bei getHouseholdSummary', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.getHouseholdSummary(householdId, user),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
