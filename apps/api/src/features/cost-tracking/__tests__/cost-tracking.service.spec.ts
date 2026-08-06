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
    objectShare: { findMany: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn(), findMany: vi.fn() },
    policyCostEntry: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
    objectShare: { findMany: vi.fn() },
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

  function mockMembership() {
    mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
  }

  function mockPolicy(policy: Record<string, unknown> = {}) {
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, ...policy });
  }

  describe('create', () => {
    it('erstellt eine Kostenposition und protokolliert Audit', async () => {
      mockMembership();
      mockPolicy();
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

    it('BugFix-08: beendet den Vorgaenger automatisch bei Kosten-Erhoehung (validFrom)', async () => {
      mockMembership();
      mockPolicy();
      // Bestehender Eintrag ab 01.01.2024 (offen), neue Erhoehung ab 01.01.2025.
      // findMany spiegelt die Sicht der interaktiven Transaktion wider: Der
      // eben erzeugte Eintrag ist bereits sichtbar und darf NICHT als sein
      // eigener Vorgaenger beendet werden.
      mockDb.policyCostEntry.create.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        grossAmount: 150,
        frequency: 'MONTHLY',
      });
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
        {
          id: entryId,
          grossAmount: 150,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        },
      ]);

      await service.create(householdId, userId, policyId, {
        validFrom: '2025-01-01',
        grossAmount: 150,
        frequency: PaymentFrequency.MONTHLY,
      });

      // Vorgaenger (c1) wird auf letzte Millisekunde vor dem neuen validFrom
      // gesetzt – NICHT der neu erzeugte Eintrag selbst.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: new Date('2024-12-31T23:59:59.999Z') }),
        }),
      );
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ diffJson: expect.objectContaining({ predecessorEnded: true }) }),
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
      mockMembership();
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
      mockMembership();
      mockPolicy();

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-06-01',
          validTo: '2025-01-01',
          grossAmount: 100,
          frequency: PaymentFrequency.MONTHLY,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert Erstellung bei doppeltem validFrom', async () => {
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({ id: 'c1' });

      await expect(
        service.create(householdId, userId, policyId, {
          validFrom: '2025-01-01',
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
      mockMembership();
      mockPolicy();
      mockDb.policyCostEntry.findFirst.mockResolvedValue({
        id: entryId,
        policyId,
        validFrom: new Date('2025-01-01'),
        validTo: null,
      });
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
      mockMembership();
      mockPolicy();
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

    it('BugFix-08: synchronisiert den Vorgaenger bei validFrom-Aenderung neu', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) bearbeiteter Eintrag, 2) Kollisionscheck, 3) restorePredecessor.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-06-01'),
          validTo: null,
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockDb.policyCostEntry.update.mockResolvedValue({
        id: entryId,
        grossAmount: 150,
        frequency: 'MONTHLY',
      });
      // findMany spiegelt die Transaktionssicht: auch der bearbeitete Eintrag
      // ist sichtbar und darf NICHT als sein eigener Vorgaenger beendet werden.
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
        {
          id: entryId,
          grossAmount: 150,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-06-01'),
          validTo: null,
        },
      ]);

      await service.update(householdId, userId, policyId, entryId, {
        validFrom: '2025-07-01',
      });

      // c1 wird auf letzte Millisekunde vor dem neuen validFrom beendet –
      // nicht der bearbeitete Eintrag selbst.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: new Date('2025-06-30T23:59:59.999Z') }),
        }),
      );
    });

    it('BugFix-08: validFrom nach hinten verschoben schliesst die Luecke (Vorgaenger wird wieder geoeffnet)', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) bearbeiteter Eintrag, 2) Kollisionscheck, 3) restorePredecessor.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: null,
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c1' });
      // update: 1) Eintrag selbst, 2) c1 wieder geoeffnet, 3) c1 am neuen validFrom beendet.
      mockDb.policyCostEntry.update
        .mockResolvedValueOnce({ id: entryId, grossAmount: 150, frequency: 'MONTHLY' })
        .mockResolvedValueOnce({ id: 'c1', validTo: null })
        .mockResolvedValueOnce({ id: 'c1', validTo: new Date('2026-12-31T23:59:59.999Z') });
      // Transaktionssicht NACH restorePredecessor: c1 ist wieder geoeffnet
      // (validTo null) und existiert neben dem bearbeiteten Eintrag c2.
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        {
          id: 'c1',
          grossAmount: 100,
          frequency: 'MONTHLY',
          validFrom: new Date('2024-01-01'),
          validTo: null,
        },
        {
          id: entryId,
          grossAmount: 150,
          frequency: 'MONTHLY',
          validFrom: new Date('2025-01-01'),
          validTo: null,
        },
      ]);

      await service.update(householdId, userId, policyId, entryId, {
        validFrom: '2027-01-01',
      });

      // 1) c1 wird zuerst wieder geoeffnet (kein Zeitraum ohne Eintrag) ...
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: null }),
        }),
      );
      // 2) ... und anschliessend am NEUEN validFrom beendet (deckt 2025+2026 ab).
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: new Date('2026-12-31T23:59:59.999Z') }),
        }),
      );
    });

    it('BugFix-08: validFrom hinter eigenes auto-beendetes validTo verschoben entfernt das veraltete validTo (Middle-Entry, Review 3)', async () => {
      mockMembership();
      mockPolicy();
      // c2 wurde durch c3 automatisch beendet: validTo = 2025-05-31T23:59:59.999.
      // findFirst: 1) bearbeiteter Eintrag, 2) Auto-End-Signatur (c3 beginnt
      // 1ms nach c2.validTo), 3) Kollisionscheck, 4) restorePredecessor.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: new Date('2025-05-31T23:59:59.999Z'),
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce({ id: 'c3' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c1' });
      // update: 1) c2 selbst (veraltetes validTo entfernt), 2) c1 wieder
      // geoeffnet, 3) c3 am neuen validFrom beendet.
      mockDb.policyCostEntry.update
        .mockResolvedValueOnce({ id: entryId, grossAmount: 150, frequency: 'MONTHLY', validTo: null })
        .mockResolvedValueOnce({ id: 'c1', validTo: null })
        .mockResolvedValueOnce({ id: 'c3', validTo: new Date('2025-12-31T23:59:59.999Z') });
      // Transaktionssicht nach restorePredecessor: c1 offen, c2 ausgeschlossen,
      // c3 offen.
      mockDb.policyCostEntry.findMany.mockResolvedValue([
        { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: null },
        { id: entryId, grossAmount: 150, frequency: 'MONTHLY', validFrom: new Date('2025-01-01'), validTo: null },
        { id: 'c3', grossAmount: 200, frequency: 'MONTHLY', validFrom: new Date('2025-06-01'), validTo: null },
      ]);

      await service.update(householdId, userId, policyId, entryId, {
        validFrom: '2026-01-01',
      });

      // 1) c2: das veraltete (auto-beendete) validTo entfaellt – der Eintrag
      // ist ab dem neuen validFrom aktiv.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: entryId },
          data: expect.objectContaining({ validFrom: new Date('2026-01-01'), validTo: null }),
        }),
      );
      // 2) c1 wird wieder geoeffnet (deckt bis zur naechsten Erhoehung).
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ validTo: null }) }),
      );
      // 3) c3 wird am neuen validFrom beendet – kein Zeitraum ohne Eintrag.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c3' },
          data: expect.objectContaining({ validTo: new Date('2025-12-31T23:59:59.999Z') }),
        }),
      );
    });

    it('BugFix-08: manuell gesetztes validTo wird bei validFrom-Verschiebung nicht stillschweigend entfernt (Review 4)', async () => {
      mockMembership();
      mockPolicy();
      // Manuell gesetztes validTo (2025-06-30) OHNE Nachfolger-Signatur:
      // kein Eintrag beginnt exakt 1ms spaeter (2025-07-01).
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: new Date('2025-06-30'),
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.update(householdId, userId, policyId, entryId, {
          validFrom: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('loescht einen CostEntry und protokolliert Audit', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) zu loeschender Eintrag, 2) restorePredecessor (keiner beendet).
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          grossAmount: 100,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce(null);
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

    it('BugFix-08: Loeschen einer Erhoehung oeffnet den Vorgaenger wieder (keine Luecke)', async () => {
      mockMembership();
      mockPolicy();
      // findFirst: 1) zu loeschender Eintrag (Erhoehung ab 2025-01-01),
      // 2) restorePredecessor findet den automatisch beendeten Vorgaenger c1.
      mockDb.policyCostEntry.findFirst
        .mockResolvedValueOnce({
          id: entryId,
          policyId,
          validFrom: new Date('2025-01-01'),
          validTo: null,
          grossAmount: 150,
          frequency: 'MONTHLY',
        })
        .mockResolvedValueOnce({ id: 'c1' });
      mockDb.policyCostEntry.delete.mockResolvedValue({ id: entryId });
      mockDb.policyCostEntry.update.mockResolvedValue({ id: 'c1', validTo: null });

      await service.remove(householdId, userId, policyId, entryId);

      // c1 (beendet am 2024-12-31T23:59:59.999) wird wieder geoeffnet.
      expect(mockDb.policyCostEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ validTo: null }),
        }),
      );
    });
  });

  describe('getSchedule (BugFix-08: Perioden-Tabelle incurred/expected)', () => {
    function mockScheduleData(
      policy: Record<string, unknown>,
      entries: Array<Record<string, unknown>>,
    ) {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId, ...policy });
      mockDb.policyCostEntry.findMany.mockResolvedValue(entries);
    }

    it('paidToDate = Summe der vollen begonnenen Perioden (keine Tagesanteile)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-15'),
            validTo: null,
          },
        ],
      );

      // Fixer Zeitpunkt: 3 volle Perioden begonnen (15.01., 15.02., 15.03.).
      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.current?.frequency).toBe('MONTHLY');
      expect(result.paidToDate).toBe(300);
      // Vergangenheit = incurred, Zukunft = expected (projiziert aus aktivem Eintrag).
      expect(result.periods[0].status).toBe('incurred');
      expect(result.periods[0].amount).toBe(100);
      expect(result.periods[2].periodLabel).toBe('03/2024');
      expect(result.periods[2].status).toBe('incurred');
      expect(result.periods[3].status).toBe('expected');
      expect(result.periods[3].amount).toBe(100);
    });

    it('nutzt die Jahresfrequenz der Versicherung (jaehrlich, 01/2024, ...)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.ANNUAL },
        [
          {
            id: 'c1',
            grossAmount: 500,
            netAmount: null,
            frequency: 'ANNUAL',
            validFrom: new Date('2024-01-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.paidToDate).toBe(500);
      expect(result.periods[0].periodLabel).toBe('01/2024');
      expect(result.periods[0].status).toBe('incurred');
      expect(result.current?.annualGross).toBe(500);
    });

    it('BugFix-08: Frequenzwechsel – Erhoehung ab 06/2024 fliesst in alle Folgeperioden ein', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
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
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-08-31T12:00:00.000Z'),
      );

      // 5 Perioden zu 100 (01-05/2024) + 3 Perioden zu 120 (06-08/2024).
      expect(result.paidToDate).toBe(5 * 100 + 3 * 120);
      expect(result.periods[5].periodLabel).toBe('06/2024');
      expect(result.periods[5].amount).toBe(120);
      expect(result.periods[6].amount).toBe(120);
      expect(result.current?.grossAmount).toBe(120);
    });

    it('BugFix-08: Kosten-Erhoehung mitten im Jahr (increase-mid-year)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-01'),
            validTo: new Date('2024-05-31'),
          },
          {
            id: 'c2',
            grossAmount: 150,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-06-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-12-15T12:00:00.000Z'),
      );

      // Alle 12 Perioden 2024 begonnen: 5 * 100 + 7 * 150.
      expect(result.paidToDate).toBe(5 * 100 + 7 * 150);
      expect(result.periods[4].amount).toBe(100);
      expect(result.periods[5].amount).toBe(150);
    });

    it('skaliert Eintraege, deren Frequenz von der Abrechnungsfrequenz abweicht', async () => {
      // Versicherung MONTHLY, Kosten-Eintrag QUARTERLY (300): jede Monatsperiode
      // schuldet 300/3 = 100 – Jahres-Summe bleibt konsistent.
      mockScheduleData(
        { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 300,
            netAmount: null,
            frequency: 'QUARTERLY',
            validFrom: new Date('2024-01-01'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.paidToDate).toBe(300);
      for (const period of result.periods.slice(0, 3)) {
        expect(period.amount).toBe(100);
      }
    });

    it('realigned Perioden nach kurzen Monaten am Anker (Schaltjahr 2024)', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-31'), paymentFrequency: PaymentFrequency.MONTHLY },
        [
          {
            id: 'c1',
            grossAmount: 100,
            netAmount: null,
            frequency: 'MONTHLY',
            validFrom: new Date('2024-01-31'),
            validTo: null,
          },
        ],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-31T12:00:00.000Z'),
      );

      expect(result.periods[0].periodStart).toBe('2024-01-31T00:00:00.000Z');
      expect(result.periods[1].periodStart).toBe('2024-02-29T00:00:00.000Z');
      expect(result.periods[2].periodStart).toBe('2024-03-31T00:00:00.000Z');
    });

    it('liefert leere Periodenliste ohne CostEntries', async () => {
      mockScheduleData(
        { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
        [],
      );

      const result = await service.getSchedule(
        householdId,
        user,
        policyId,
        new Date('2024-03-20T12:00:00.000Z'),
      );

      expect(result.paidToDate).toBe(0);
      expect(result.current).toBeNull();
      expect(result.periods).toEqual([]);
    });

    it('wirft NotFoundException bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.getSchedule(householdId, user, policyId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHouseholdSummary (BugFix-08 Q5: Haushaltsuebersicht)', () => {
    it('aggregiert paidToDate, Monat, Jahr und perYear-Buckets ueber alle Policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'HAFTPFLICHT',
          insurerName: 'P1',
          costEntries: [
            { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
        {
          id: 'p2',
          householdId,
          type: 'HAUSRAT',
          insurerName: 'P2',
          costEntries: [
            { id: 'c2', grossAmount: 500, frequency: 'ANNUAL', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2025-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(2);
      // p1: 15 Monatsperioden begonnen (01/2024-03/2025) -> 1500, p2: 2 Jahresperioden -> 1000.
      expect(result.totals.paidToDate).toBe(2500);
      expect(result.totals.perYear).toBe(1700);
      // 100 (MONTHLY) + 500/12 (ANNUAL) = 141.67.
      expect(result.totals.perMonth).toBe(141.67);
      // Historische Buckets: 2024 -> 1200 + 500, 2025 -> 3 * 100 + 500.
      expect(result.perYear).toEqual([
        { year: 2024, amount: 1700 },
        { year: 2025, amount: 800 },
      ]);
      expect(result.policies[0].paidToDate).toBe(1500);
      expect(result.policies[0].perMonth).toBe(100);
    });

    it('bugFix-08: perYear-Bucket beachtet Kosten-Erhoehung mitten im Jahr', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          householdId,
          type: 'KFZ',
          insurerName: 'P1',
          costEntries: [
            { id: 'c1', grossAmount: 100, frequency: 'MONTHLY', validFrom: new Date('2024-01-01'), validTo: new Date('2024-06-30') },
            { id: 'c2', grossAmount: 150, frequency: 'MONTHLY', validFrom: new Date('2024-07-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2024-12-31T12:00:00.000Z'),
      );

      // 6 * 100 + 6 * 150 = 1500 im Jahr 2024.
      expect(result.perYear).toEqual([{ year: 2024, amount: 1500 }]);
      expect(result.totals.paidToDate).toBe(1500);
    });

    it('ignoriert archivierte Policies', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(0);
      expect(result.totals.paidToDate).toBe(0);
      expect(result.totals.perYear).toBe(0);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null },
        }),
      );
    });

    it('behandelt Policies ohne CostEntries', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findMany.mockResolvedValue([
        { id: 'p1', householdId, type: 'HAFTPFLICHT', insurerName: 'P1', costEntries: [] },
        {
          id: 'p2',
          householdId,
          type: 'HAUSRAT',
          insurerName: 'P2',
          costEntries: [
            { id: 'c2', grossAmount: 1000, frequency: 'ANNUAL', validFrom: new Date('2024-01-01'), validTo: null },
          ],
        },
      ]);

      const result = await service.getHouseholdSummary(
        householdId,
        user,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(2);
      expect(result.policies[0].paidToDate).toBe(0);
      expect(result.policies[0].entryCount).toBe(0);
      expect(result.totals.paidToDate).toBe(1000);
    });

    it('READ_ONLY: summiert nur explizit freigegebene Policies (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };
      // Keine Freigaben -> getReadablePolicyIds liefert [].
      mockDb.objectShare.findMany.mockResolvedValue([]);
      mockDb.insurancePolicy.findMany.mockResolvedValue([]);

      const result = await service.getHouseholdSummary(
        householdId,
        readOnlyUser,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(0);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null, id: { in: [] } },
        }),
      );
    });

    it('READ_ONLY: nutzt freigegebene Policy-IDs als Filter', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };
      mockDb.objectShare.findMany.mockResolvedValue([
        { scopeType: 'INSURANCE', scopeRef: 'p1', sourceUserId: userId },
      ]);
      mockDb.insurancePolicy.findMany
        .mockResolvedValueOnce([{ id: 'p1', householdId, archivedAt: null, type: 'KFZ', insurerName: 'P1' }]) // getReadablePolicyIds
        .mockResolvedValueOnce([]); // Summary ohne Treffer (Freigabe deckt nichts ab)

      const result = await service.getHouseholdSummary(
        householdId,
        readOnlyUser,
        new Date('2024-03-01T12:00:00.000Z'),
      );

      expect(result.policyCount).toBe(0);
      expect(mockDb.insurancePolicy.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { householdId, archivedAt: null, id: { in: ['p1'] } },
        }),
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

    it('verweigert Zugriff ohne Mitgliedschaft bei getSchedule', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.getSchedule(householdId, user, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Zugriff ohne Mitgliedschaft bei getHouseholdSummary', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.getHouseholdSummary(householdId, user),
      ).rejects.toThrow(ForbiddenException);
    });

    it('READ_ONLY: verweigert findAll ohne explizite Freigabe (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.objectShare.findMany.mockResolvedValue([]);
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };

      await expect(
        service.findAll(householdId, readOnlyUser, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('READ_ONLY: verweigert findOne ohne explizite Freigabe (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.objectShare.findMany.mockResolvedValue([]);
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };

      await expect(
        service.findOne(householdId, readOnlyUser, policyId, entryId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('READ_ONLY: verweigert getSchedule ohne explizite Freigabe (AP-16)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'READ_ONLY' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.objectShare.findMany.mockResolvedValue([]);
      const readOnlyUser = { ...user, role: GlobalRole.READ_ONLY };

      await expect(
        service.getSchedule(householdId, readOnlyUser, policyId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
