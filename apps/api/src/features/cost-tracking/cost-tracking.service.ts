import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { GlobalRole, PaymentFrequency } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import { CreateCostEntryDto, UpdateCostEntryDto } from './dto/cost-tracking.dto';

const FREQUENCY_MAP: Record<PaymentFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMI_ANNUAL: 2,
  ANNUAL: 1,
};

// Durchschnittliche Periodenlaenge in Tagen (365.25-Tage-Jahr) – Basis fuer die
// anteilige "bisher gezahlt"-Berechnung (BugFix-05, Befund 3).
const PERIOD_DAYS: Record<PaymentFrequency, number> = {
  MONTHLY: 365.25 / 12,
  QUARTERLY: 365.25 / 4,
  SEMI_ANNUAL: 365.25 / 2,
  ANNUAL: 365.25,
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

@Injectable()
export class CostTrackingService {
  private readonly logger = new Logger(CostTrackingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }
  }

  private async assertPolicyAccess(householdId: string, userId: string, policyId: string): Promise<void> {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }
  }

  private calculateAnnualGross(entry: { grossAmount: number; frequency: PaymentFrequency; validFrom: Date; validTo: Date | null }): number {
    const annual = Number(entry.grossAmount) * FREQUENCY_MAP[entry.frequency];

    if (!entry.validTo) return Math.round(annual * 100) / 100;

    const days = Math.round((entry.validTo.getTime() - entry.validFrom.getTime()) / MS_PER_DAY) + 1;

    if (days > 0 && days < 365) {
      return Math.round(annual * (days / 365) * 100) / 100;
    }

    return Math.round(annual * 100) / 100;
  }

  /** Alle vier Periodenbetraege, abgeleitet aus dem Jahresbetrag (Befund 3/7). */
  private derivePerFrequency(annualGross: number) {
    return {
      MONTHLY: Math.round((annualGross / 12) * 100) / 100,
      QUARTERLY: Math.round((annualGross / 4) * 100) / 100,
      SEMI_ANNUAL: Math.round((annualGross / 2) * 100) / 100,
      ANNUAL: annualGross,
    };
  }

  /**
   * Bisher faellige Betraege bis `now`: je Eintrag anteilig (validFrom →
   * min(validTo, now)) anhand der Periodenlaenge. Gemeinsame Logik von
   * `getOverview` (Befund 3) und `getHouseholdSummary` (Befund 7).
   */
  private calculatePaidToDate(entries: { grossAmount: unknown; frequency: PaymentFrequency; validFrom: Date; validTo: Date | null }[], now: Date): number {
    let paidToDate = 0;
    for (const entry of entries) {
      if (entry.validFrom > now) continue;
      const from = entry.validFrom;
      const to = entry.validTo && entry.validTo < now ? entry.validTo : now;
      const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
      if (days <= 0) continue;
      paidToDate += Number(entry.grossAmount) * (days / PERIOD_DAYS[entry.frequency]);
    }
    return Math.round(paidToDate * 100) / 100;
  }

  /** Aktiven (sonst letzten) Kosten-Eintrag ermitteln – gemeinsame Basis der Uebersichten. */
  private selectActiveOrLatestEntry<T extends { validFrom: Date; validTo: Date | null }>(entries: T[], now: Date): T | null {
    if (entries.length === 0) return null;
    return (
      entries
        .filter((e) => e.validFrom <= now && (!e.validTo || e.validTo >= now))
        .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null
    );
  }

  async create(householdId: string, userId: string, policyId: string, dto: CreateCostEntryDto) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const validFrom = new Date(dto.validFrom);
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validTo && validTo <= validFrom) {
      throw new BadRequestException('validTo muss nach validFrom liegen');
    }

    return this.db.$transaction(async (tx) => {
      const entry = await tx.policyCostEntry.create({
        data: {
          policyId,
          validFrom,
          validTo,
          grossAmount: dto.grossAmount,
          netAmount: dto.netAmount,
          frequency: dto.frequency,
          bookingSource: dto.bookingSource,
          note: dto.note,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyCostEntry',
          entityId: entry.id,
          action: 'CREATE',
          diffJson: {
            policyId,
            validFrom: dto.validFrom,
            validTo: dto.validTo ?? null,
            grossAmount: dto.grossAmount,
            netAmount: dto.netAmount ?? null,
            frequency: dto.frequency,
            bookingSource: dto.bookingSource ?? null,
            note: dto.note ?? null,
          },
        },
      });

      return entry;
    }).catch((err) => {
      this.logger.error(`create cost entry failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async findAll(householdId: string, user: AuthenticatedUser, policyId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    return this.db.policyCostEntry.findMany({
      where: { policyId },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findOne(householdId: string, user: AuthenticatedUser, policyId: string, entryId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const entry = await this.db.policyCostEntry.findFirst({
      where: { id: entryId, policyId },
    });

    if (!entry) {
      throw new NotFoundException('Kostenposition nicht gefunden');
    }

    return entry;
  }

  async update(householdId: string, userId: string, policyId: string, entryId: string, dto: UpdateCostEntryDto) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyCostEntry.findFirst({
        where: { id: entryId, policyId },
      });

      if (!existing) {
        throw new NotFoundException('Kostenposition nicht gefunden');
      }

      const finalValidFrom = dto.validFrom ? new Date(dto.validFrom) : existing.validFrom;
      const finalValidTo = dto.validTo !== undefined
        ? (dto.validTo ? new Date(dto.validTo) : null)
        : existing.validTo;

      if (finalValidTo && finalValidTo <= finalValidFrom) {
        throw new BadRequestException('validTo muss nach validFrom liegen');
      }

      const entry = await tx.policyCostEntry.update({
        where: { id: entryId },
        data: {
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo !== undefined ? (dto.validTo ? new Date(dto.validTo) : null) : undefined,
          grossAmount: dto.grossAmount,
          netAmount: dto.netAmount,
          frequency: dto.frequency,
          bookingSource: dto.bookingSource,
          note: dto.note,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyCostEntry',
          entityId: entryId,
          action: 'UPDATE',
          diffJson: { ...dto },
        },
      });

      return entry;
    }).catch((err) => {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`update cost entry ${entryId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async remove(householdId: string, userId: string, policyId: string, entryId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyCostEntry.findFirst({
        where: { id: entryId, policyId },
      });

      if (!existing) {
        throw new NotFoundException('Kostenposition nicht gefunden');
      }

      await tx.policyCostEntry.delete({ where: { id: entryId } });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyCostEntry',
          entityId: entryId,
          action: 'DELETE',
          diffJson: {
            policyId,
            entryId,
            grossAmount: Number(existing.grossAmount),
            frequency: existing.frequency,
          },
        },
      });

      return { success: true };
    }).catch((err) => {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`remove cost entry ${entryId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  /**
   * BugFix-05 (Befund 3): Kostenuebersicht je Versicherung.
   * - `annualGross`/`annualNet`: auf Basis des aktiven (sonst letzten) Eintrags
   * - `perFrequency`: alle vier Periodenbetraege (MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL),
   *   abgeleitet aus dem Jahresbetrag – die UI zeigt passend zur Frequenz-Einstellung
   * - `paidToDate`: Summe der bereits faelligen Betraege bis heute, anteilig je
   *   Eintrag (validFrom → min(validTo, heute)) anhand der Periodenlaenge
   */
  async getOverview(householdId: string, user: AuthenticatedUser, policyId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const entries = await this.db.policyCostEntry.findMany({
      where: { policyId },
      orderBy: { validFrom: 'asc' },
    });

    if (entries.length === 0) {
      return null;
    }

    const now = new Date();
    const active = this.selectActiveOrLatestEntry(entries, now);
    const latestEntry = active ?? entries[entries.length - 1];

    const annualGross = this.calculateAnnualGross({
      grossAmount: Number(latestEntry.grossAmount),
      frequency: latestEntry.frequency,
      validFrom: latestEntry.validFrom,
      validTo: latestEntry.validTo,
    });

    const annualNet = latestEntry.netAmount
      ? this.calculateAnnualGross({
          grossAmount: Number(latestEntry.netAmount),
          frequency: latestEntry.frequency,
          validFrom: latestEntry.validFrom,
          validTo: latestEntry.validTo,
        })
      : null;

    return {
      policyId,
      asOf: now.toISOString(),
      annualGross,
      annualNet,
      perFrequency: this.derivePerFrequency(annualGross),
      paidToDate: this.calculatePaidToDate(entries, now),
      calculationBasis: {
        entryId: latestEntry.id,
        frequency: latestEntry.frequency,
        grossAmount: Number(latestEntry.grossAmount),
        validFrom: latestEntry.validFrom,
        validTo: latestEntry.validTo,
      },
    };
  }

  async getAnnualCost(householdId: string, user: AuthenticatedUser, policyId: string) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const now = new Date();

    const activeEntry = await this.db.policyCostEntry.findFirst({
      where: {
        policyId,
        validFrom: { lte: now },
        OR: [
          { validTo: null },
          { validTo: { gte: now } },
        ],
      },
      orderBy: { validFrom: 'desc' },
    });

    const latestEntry = activeEntry ?? await this.db.policyCostEntry.findFirst({
      where: { policyId },
      orderBy: { validFrom: 'desc' },
    });

    if (!latestEntry) {
      return null;
    }

    const annualGross = this.calculateAnnualGross({
      grossAmount: Number(latestEntry.grossAmount),
      frequency: latestEntry.frequency,
      validFrom: latestEntry.validFrom,
      validTo: latestEntry.validTo,
    });

    const annualNet = latestEntry.netAmount
      ? this.calculateAnnualGross({
          grossAmount: Number(latestEntry.netAmount),
          frequency: latestEntry.frequency,
          validFrom: latestEntry.validFrom,
          validTo: latestEntry.validTo,
        })
      : null;

    const year = latestEntry.validFrom.getFullYear();

    return {
      policyId,
      year,
      annualGross,
      annualNet,
      calculationBasis: {
        entryId: latestEntry.id,
        frequency: latestEntry.frequency,
        grossAmount: Number(latestEntry.grossAmount),
        validFrom: latestEntry.validFrom,
        validTo: latestEntry.validTo,
      },
    };
  }

  private async findEntryForYear(policyId: string, year: number) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    const overlapping = await this.db.policyCostEntry.findFirst({
      where: {
        policyId,
        validFrom: { lte: yearEnd },
        OR: [
          { validTo: null },
          { validTo: { gte: yearStart } },
        ],
      },
      orderBy: { validFrom: 'desc' },
    });

    if (overlapping) return overlapping;

    const beforeYear = await this.db.policyCostEntry.findFirst({
      where: {
        policyId,
        validFrom: { lte: yearStart },
      },
      orderBy: { validFrom: 'desc' },
    });

    return beforeYear ?? null;
  }

  async getYearComparison(householdId: string, user: AuthenticatedUser, policyId: string, year: number) {
    if (isNaN(year)) {
      throw new BadRequestException('Ungueltiges Jahr');
    }

    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const currentEntry = await this.findEntryForYear(policyId, year);

    if (!currentEntry) {
      return null;
    }

    const prevYear = year - 1;

    const previousEntry = await this.findEntryForYear(policyId, prevYear);

    const currentAnnual = this.calculateAnnualGross({
      grossAmount: Number(currentEntry.grossAmount),
      frequency: currentEntry.frequency,
      validFrom: currentEntry.validFrom,
      validTo: currentEntry.validTo,
    });

    if (!previousEntry) {
      return {
        policyId,
        currentYear: { year, annualGross: currentAnnual },
        previousYear: null,
        absoluteChange: null,
        percentageChange: null,
        increased: null,
      };
    }

    const previousAnnual = this.calculateAnnualGross({
      grossAmount: Number(previousEntry.grossAmount),
      frequency: previousEntry.frequency,
      validFrom: previousEntry.validFrom,
      validTo: previousEntry.validTo,
    });

    const absoluteChange = Math.round((currentAnnual - previousAnnual) * 100) / 100;
    const percentageChange = previousAnnual !== 0
      ? Math.round(((currentAnnual - previousAnnual) / previousAnnual) * 10000) / 100
      : null;

    return {
      policyId,
      currentYear: { year, annualGross: currentAnnual },
      previousYear: { year: prevYear, annualGross: previousAnnual },
      absoluteChange,
      percentageChange,
      increased: absoluteChange >= 0,
    };
  }

  async getHouseholdSummary(householdId: string, user: AuthenticatedUser) {
    await this.assertHouseholdAccess(householdId, user.id);

    const now = new Date();

    // READ_ONLY: Summe nur ueber explizit freigegebene Policies (ADR-007/AP-16)
    const readableIds = await this.authService.getReadablePolicyIds(user, householdId);
    const where =
      user.role === GlobalRole.READ_ONLY && readableIds
        ? { householdId, archivedAt: null, id: { in: readableIds } }
        : { householdId, archivedAt: null };

    const policies = await this.db.insurancePolicy.findMany({
      where,
      include: {
        costEntries: {
          orderBy: { validFrom: 'desc' },
        },
      },
    });

    // BugFix-05 (Befund 7): Je Versicherung einzeln (id, name, type, annualGross,
    // perFrequency, paidToDate) – gleiche Berechnungslogik wie getOverview (Befund 3).
    const policiesWithCosts: Array<{
      id: string;
      name: string;
      type: string;
      frequency: PaymentFrequency | null;
      annualGross: number | null;
      perFrequency: { MONTHLY: number; QUARTERLY: number; SEMI_ANNUAL: number; ANNUAL: number } | null;
      paidToDate: number;
    }> = [];

    let totalAnnualGross = 0;
    const perType: Record<string, number> = {};

    for (const policy of policies) {
      const type = policy.type;
      if (!(type in perType)) {
        perType[type] = 0;
      }

      const entryCount = policy.costEntries.length;

      if (entryCount > 0) {
        const latest = this.selectActiveOrLatestEntry(policy.costEntries, now) ?? policy.costEntries[0];
        const annual = this.calculateAnnualGross({
          grossAmount: Number(latest.grossAmount),
          frequency: latest.frequency,
          validFrom: latest.validFrom,
          validTo: latest.validTo,
        });
        totalAnnualGross += annual;
        perType[type] += annual;
        policiesWithCosts.push({
          id: policy.id,
          name: policy.insurerName,
          type,
          frequency: latest.frequency,
          annualGross: Math.round(annual * 100) / 100,
          perFrequency: this.derivePerFrequency(annual),
          paidToDate: this.calculatePaidToDate(policy.costEntries, now),
        });
      } else {
        policiesWithCosts.push({
          id: policy.id,
          name: policy.insurerName,
          type,
          frequency: null,
          annualGross: null,
          perFrequency: null,
          paidToDate: 0,
        });
      }
    }

    totalAnnualGross = Math.round(totalAnnualGross * 100) / 100;
    for (const key of Object.keys(perType)) {
      perType[key] = Math.round(perType[key] * 100) / 100;
    }

    return {
      totalAnnualGross,
      perType,
      policyCount: policies.length,
      policies: policiesWithCosts,
    };
  }
}
