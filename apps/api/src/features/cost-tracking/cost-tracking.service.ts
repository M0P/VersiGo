import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { GlobalRole, PaymentFrequency } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import { CreateCostEntryDto, UpdateCostEntryDto } from './dto/cost-tracking.dto';

/**
 * BugFix-08 (Q4): cost overhaul.
 *
 * - Billing periods: MONTHLY / QUARTERLY / ANNUAL for new entries.
 *   SEMI_ANNUAL stays as a legacy value for existing data in the enum
 *   and is correctly supported in all calculations (6-month period).
 *   Documented loss-free decision: NO data migration needed.
 * - A cost increase from a date = a new entry with a later validFrom;
 *   the previously valid entry is automatically ended when a new one
 *   is created
 *   (validTo = last millisecond before the new validFrom). At any point in
 *   time exactly one entry applies: the one with the largest validFrom
 *   <= period start (and without an explicit end before that).
 * - "Paid to date" (paidToDate) = sum of the full amounts of all started
 *   billing periods (period start <= today, due at period start).
 *   NO day shares - BugFix-06 (part 3) semantics remain unchanged.
 * - Monetary amounts: sum internally in cents (integer); all returned
 *   amounts rounded to 2 decimals. Floating-point sums are never formed.
 */

/** Period length per payment frequency in months (basis of all calculations). */
const FREQUENCY_MONTHS: Record<PaymentFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

/** Periods per year per frequency (e.g. MONTHLY = 12 -> annual amount). */
const FREQUENCY_PER_YEAR: Record<PaymentFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMI_ANNUAL: 2,
  ANNUAL: 1,
};

/**
 * Calendar addition of months with day-value clamping. IMPORTANT: every call
 * always starts from the passed anchor date (never from an already
 * clamped intermediate result) - so periods realign automatically back at
 * the anchor: from anchor 31.01. + 1 month = 28./29.02., + 2 months again
 * 31.03., + 3 months 30.04. etc. (no drift).
 */
function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfMonth));
  return result;
}

/** Rounds to 2 decimals (display/single amounts). */
function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Amount -> integer cents (basis for loss-free sums). */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer cents -> amount with 2 decimals. */
function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** A cost entry as required by the calculation logic. */
type CostEntryLike = {
  id?: string;
  createdAt?: Date | string | null;
  grossAmount: unknown;
  netAmount?: unknown;
  frequency: PaymentFrequency;
  validFrom: Date;
  validTo: Date | null;
};

/** Billing data of a policy (anchor + billing frequency). */
type BillingPlan = {
  anchor: Date;
  frequency: PaymentFrequency;
  stepMonths: number;
};

/** One billing period in the cost table (incurred/expected). */
type BillingPeriod = {
  periodIndex: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: 'incurred' | 'expected';
  entryId: string | null;
};

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
      throw new ForbiddenException('Isolation: no access to a foreign household');
    }
  }

  private async assertPolicyAccess(householdId: string, userId: string, policyId: string): Promise<void> {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Policy not found');
    }
  }

  /**
   * Relevant cost entry for a period: the entry with the largest
   * validFrom <= period start, unless it was explicitly ended before
   * the period start (validTo < period start).
   * Returns null if no entry exists before periodStart or the last entry
   * has already ended (cost regression/gap). For an identical validFrom
   * the newer entry wins (createdAt).
   */
  private entryForPeriod<T extends CostEntryLike>(entries: T[], periodStart: Date): T | null {
    const startMs = periodStart.getTime();
    return (
      entries
        .filter(
          (e) =>
            e.validFrom.getTime() <= startMs &&
            (!e.validTo || e.validTo.getTime() >= startMs),
        )
        .sort((a, b) => {
          const byFrom = b.validFrom.getTime() - a.validFrom.getTime();
          if (byFrom !== 0) return byFrom;
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bCreated - aCreated;
        })[0] ?? null
    );
  }

  /** Determines the active (otherwise latest) cost entry – shared basis of the overviews. */
  private selectActiveOrLatestEntry<T extends CostEntryLike>(entries: T[], now: Date): T | null {
    if (entries.length === 0) return null;
    return (
      entries
        .filter((e) => e.validFrom.getTime() <= now.getTime() && (!e.validTo || e.validTo.getTime() >= now.getTime()))
        .sort((a, b) => {
          const byFrom = b.validFrom.getTime() - a.validFrom.getTime();
          if (byFrom !== 0) return byFrom;
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bCreated - aCreated;
        })[0] ?? entries[entries.length - 1]
    );
  }

  /**
   * Determines the anchor (policy start, fallback: earliest entry) and
   * billing frequency (policy paymentFrequency, fallback: frequency of
   * the active/latest entry, otherwise MONTHLY).
   */
  private resolveBilling<T extends CostEntryLike>(
    policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
    entries: T[],
    now: Date,
  ): BillingPlan {
    const active = this.selectActiveOrLatestEntry(entries, now);
    const anchor = policy.startDate ?? entries[0].validFrom;
    const frequency = policy.paymentFrequency ?? active?.frequency ?? PaymentFrequency.MONTHLY;
    return { anchor, frequency, stepMonths: FREQUENCY_MONTHS[frequency] };
  }

  /**
   * Due amount of a cost entry in a billing period of the step frequency
   * `stepFrequency`. If the entry's own frequency differs from the step
   * frequency (e.g. policy MONTHLY, entry QUARTERLY), the amount is prorated
   * to the period so that the annual total stays consistent
   * (300 QUARTERLY = 100/month).
   */
  private periodAmount(entry: CostEntryLike, stepFrequency: PaymentFrequency): number {
    const stepMonths = FREQUENCY_MONTHS[stepFrequency];
    const entryMonths = FREQUENCY_MONTHS[entry.frequency];
    if (stepMonths === entryMonths) {
      return roundMoney(Number(entry.grossAmount));
    }
    return roundMoney(Number(entry.grossAmount) * (stepMonths / entryMonths));
  }

  /**
   * Generates all billing periods from the anchor to `horizonEnd` (inclusive).
   * Past periods (period start <= now) are 'incurred' (contribution due at
   * period start), future 'expected' (projected from the currently valid
   * entry). Each period counts the relevant cost entry (active at period
   * start, otherwise the last one before - see entryForPeriod).
   */
  private iteratePeriods<T extends CostEntryLike>(
    policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
    entries: T[],
    now: Date,
    horizonEnd: Date,
  ): BillingPeriod[] {
    if (entries.length === 0) return [];
    const { anchor, frequency, stepMonths } = this.resolveBilling(policy, entries, now);
    const horizonMs = horizonEnd.getTime();

    const periods: BillingPeriod[] = [];
    let index = 0;
    for (;;) {
      const periodStart = addMonthsClamped(anchor, index * stepMonths);
      if (periodStart.getTime() > horizonMs) break;
      const periodEndExclusive = addMonthsClamped(anchor, (index + 1) * stepMonths);
      // Inclusive period end = last moment before the next period.
      const periodEnd = new Date(periodEndExclusive.getTime() - 1);

      const entry = this.entryForPeriod(entries, periodStart);
      const amount = entry ? this.periodAmount(entry, frequency) : 0;

      periods.push({
        periodIndex: index,
        periodLabel: `${String(periodStart.getMonth() + 1).padStart(2, '0')}/${periodStart.getFullYear()}`,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        amount: roundMoney(amount),
        status: periodStart.getTime() <= now.getTime() ? 'incurred' : 'expected',
        entryId: entry?.id ?? null,
      });
      index++;
    }
    return periods;
  }

  /**
   * "Paid to date": sum of the full period amounts of all started billing
   * periods (period start <= now). Every started period counts in full -
   * there are NO day shares (BugFix-06 part 3). Summation in cents
   * (integer), result rounded to 2 decimals.
   */
  private calculatePaidToDate<T extends CostEntryLike>(
    policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
    entries: T[],
    now: Date,
  ): number {
    if (entries.length === 0) return 0;
    const { anchor, frequency, stepMonths } = this.resolveBilling(policy, entries, now);

    let totalCents = 0;
    let index = 0;
    for (;;) {
      const periodStart = addMonthsClamped(anchor, index * stepMonths);
      if (periodStart.getTime() > now.getTime()) break;
      const entry = this.entryForPeriod(entries, periodStart);
      if (entry) totalCents += toCents(this.periodAmount(entry, frequency));
      index++;
    }
    return fromCents(totalCents);
  }

  /** Annual amount of an entry (period amount * periods/year). */
  private annualize(entry: CostEntryLike): number {
    return roundMoney(Number(entry.grossAmount) * FREQUENCY_PER_YEAR[entry.frequency]);
  }

  /** Monthly/quarterly/annual amount derived from the annual amount. */
  private derivePerFrequency(annualGross: number) {
    return {
      MONTHLY: roundMoney(annualGross / 12),
      QUARTERLY: roundMoney(annualGross / 4),
      ANNUAL: roundMoney(annualGross),
    };
  }

  /**
   * Automatically ends the PREDECESSOR entry that is valid at `validFrom`
   * (validTo = last millisecond before `validFrom`). Returns true when an
   * entry has been ended. `excludeEntryId` is set to the edited entry
   * itself on updates.
   */
  private async endPredecessor(
    tx: {
      policyCostEntry: {
        findMany: (args: unknown) => Promise<CostEntryLike[]>;
        update: (args: unknown) => Promise<unknown>;
      };
    },
    policyId: string,
    validFrom: Date,
    excludeEntryId?: string,
  ): Promise<boolean> {
    const existing = (await tx.policyCostEntry.findMany({
      where: { policyId },
      orderBy: { validFrom: 'asc' },
    })) ?? [];
    const predecessor = this.entryForPeriod(
      existing.filter((e) => e.id !== excludeEntryId),
      validFrom,
    );
    if (!predecessor) return false;

    const end = new Date(validFrom.getTime() - 1);
    if (predecessor.validTo && predecessor.validTo.getTime() <= end.getTime()) return false;

    await tx.policyCostEntry.update({
      where: { id: predecessor.id },
      data: { validTo: end },
    });
    return true;
  }

  /** Ensures that no OTHER entry has the same validFrom. */
  private async assertNoValidFromCollision(
    db: { policyCostEntry: { findFirst: (args: unknown) => Promise<{ id: string } | null> } },
    policyId: string,
    validFrom: Date,
    excludeEntryId?: string,
  ): Promise<void> {
    const collision = await db.policyCostEntry.findFirst({
      where: {
        policyId,
        validFrom,
        ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
      },
      select: { id: true },
    });
    if (collision) {
      throw new BadRequestException('Another cost entry already exists at this point in time');
    }
  }

  /**
   * Reopens the predecessor entry that was automatically ended when the
   * entry with `validFrom` was created (validTo == validFrom - 1ms).
   *
   * Needed when an increase entry is postponed or deleted: otherwise a
   * period WITHOUT a valid entry would arise ("at every point in time
   * exactly one entry applies" - BugFix-08, review 2). The subsequent
   * endPredecessor sync re-ends the predecessor correctly at the NEW
   * validFrom when needed.
   */
  private async restorePredecessor(
    tx: {
      policyCostEntry: {
        findFirst: (args: unknown) => Promise<{ id: string } | null>;
        update: (args: unknown) => Promise<unknown>;
      };
    },
    policyId: string,
    validFrom: Date,
  ): Promise<boolean> {
    const oldEnd = new Date(validFrom.getTime() - 1);
    const predecessor = await tx.policyCostEntry.findFirst({
      where: { policyId, validTo: oldEnd },
      select: { id: true },
    });
    if (!predecessor) return false;

    await tx.policyCostEntry.update({
      where: { id: predecessor.id },
      data: { validTo: null },
    });
    return true;
  }

  async create(householdId: string, userId: string, policyId: string, dto: CreateCostEntryDto) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const validFrom = new Date(dto.validFrom);
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validTo && validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('validTo must be after validFrom');
    }

    return this.db.$transaction(async (tx) => {
      await this.assertNoValidFromCollision(tx, policyId, validFrom);

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

      // BugFix-08: cost increase from validFrom - the previously valid
      // entry is automatically ended (validTo = last millisecond before
      // the new validFrom). At every point in time exactly one entry
      // applies. IMPORTANT: entry.id is excluded because in the
      // interactive transaction findMany would otherwise also see the
      // just-created entry and wrongly end it as its own predecessor.
      const predecessorEnded = await this.endPredecessor(tx, policyId, validFrom, entry.id);

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
            predecessorEnded,
          },
        },
      });

      return entry;
    }).catch((err) => {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`create cost entry failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async findAll(householdId: string, user: AuthenticatedUser, policyId: string) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    return this.db.policyCostEntry.findMany({
      where: { policyId },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findOne(householdId: string, user: AuthenticatedUser, policyId: string, entryId: string) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const entry = await this.db.policyCostEntry.findFirst({
      where: { id: entryId, policyId },
    });

    if (!entry) {
      throw new NotFoundException('Cost entry not found');
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
        throw new NotFoundException('Cost entry not found');
      }

      const finalValidFrom = dto.validFrom ? new Date(dto.validFrom) : existing.validFrom;
      let finalValidTo = dto.validTo !== undefined
        ? (dto.validTo ? new Date(dto.validTo) : null)
        : existing.validTo;

      if (finalValidTo && finalValidTo.getTime() <= finalValidFrom.getTime()) {
        if (dto.validTo !== undefined) {
          // Still reject explicitly submitted contradictory values.
          throw new BadRequestException('validTo must be after validFrom');
        }
        // BugFix-08 (reviews 3+4): validFrom is moved behind a validTo that
        // was NOT explicitly set. Such a validTo originates either from
        // automatic ending by a later increase (signature: a successor starts
        // exactly one millisecond later) or from a manual input. Only in the
        // auto-end case is it removed so the
        // postponed increase takes effect from the new date; manually set
        // end dates are not silently discarded.
        const successor = await tx.policyCostEntry.findFirst({
          where: { policyId, validFrom: new Date(finalValidTo.getTime() + 1) },
          select: { id: true },
        });
        if (!successor) {
          throw new BadRequestException('validTo must be after validFrom');
        }
        finalValidTo = null;
      }

      if (finalValidFrom.getTime() !== existing.validFrom.getTime()) {
        await this.assertNoValidFromCollision(tx, policyId, finalValidFrom, entryId);
      }

      const entry = await tx.policyCostEntry.update({
        where: { id: entryId },
        data: {
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo !== undefined
            ? (dto.validTo ? new Date(dto.validTo) : null)
            : (finalValidTo === null && existing.validTo !== null ? null : undefined),
          grossAmount: dto.grossAmount,
          netAmount: dto.netAmount,
          frequency: dto.frequency,
          bookingSource: dto.bookingSource,
          note: dto.note,
        },
      });

      // BugFix-08: after a validFrom change, re-synchronize the predecessor
      // (automatic ending as when creating).
      if (finalValidFrom.getTime() !== existing.validFrom.getTime()) {
        // Review 2: if validFrom is moved BACKWARDS, first reopen the
        // predecessor that was automatically ended at the OLD validFrom -
        // otherwise a gap without a valid entry arises. endPredecessor then
        // correctly ends it again at the NEW validFrom.
        //
        // Review 4 (known limitation): if the FIRST entry is moved backwards,
        // there is no predecessor to reopen; the periods before the next
        // entry then remain without an assigned amount. This is intentional
        // (cost reduction/gap is allowed in the model - cf. entryForPeriod)
        // and is not bypassed here by inventing or moving foreign entries.
        if (finalValidFrom.getTime() > existing.validFrom.getTime()) {
          await this.restorePredecessor(tx, policyId, existing.validFrom);
        }
        await this.endPredecessor(tx, policyId, finalValidFrom, entryId);
      }

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
        throw new NotFoundException('Cost entry not found');
      }

      await tx.policyCostEntry.delete({ where: { id: entryId } });

      // BugFix-08 (Review 2): if an increase (validFrom) is deleted, reopen
      // the predecessor that was automatically ended at that time - otherwise
      // a period without a valid entry arises from the old validFrom on.
      await this.restorePredecessor(tx, policyId, existing.validFrom);

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
   * BugFix-08: complete cost table of a policy.
   * - `periods`: one row per billing period from policy start until the end
   *   of the following year (past 'incurred', future 'expected', projected
   *   from the currently valid entry).
   * - `paidToDate`: sum of the full amounts of all started periods.
   * - `current`: annual/monthly/quarterly amount from the active entry.
   */
  async getSchedule(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    // Testability hook: "today" is the current time by default.
    now: Date = new Date(),
  ) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const [policy, entries] = await Promise.all([
      this.db.insurancePolicy.findFirst({
        where: { id: policyId, householdId },
        select: { id: true, startDate: true, paymentFrequency: true },
      }),
      this.db.policyCostEntry.findMany({
        where: { policyId },
        orderBy: { validFrom: 'asc' },
      }),
    ]);

    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    if (entries.length === 0) {
      return {
        policyId,
        asOf: now.toISOString(),
        paidToDate: 0,
        current: null,
        periods: [],
      };
    }

    // Horizon: end of the calendar year following the current year.
    const horizonEnd = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999);
    const periods = this.iteratePeriods(policy, entries, now, horizonEnd);
    const paidToDate = this.calculatePaidToDate(policy, entries, now);

    // Non-null because we already returned above for entries.length === 0.
    const active = this.selectActiveOrLatestEntry(entries, now)!;
    const annualGross = this.annualize(active);
    const annualNet = active?.netAmount != null
      ? roundMoney(Number(active.netAmount) * FREQUENCY_PER_YEAR[active.frequency])
      : null;

    return {
      policyId,
      asOf: now.toISOString(),
      paidToDate,
      current: {
        annualGross,
        annualNet,
        perFrequency: this.derivePerFrequency(annualGross),
        entryId: active.id,
        frequency: active.frequency,
        grossAmount: roundMoney(Number(active.grossAmount)),
        validFrom: active.validFrom,
        validTo: active.validTo,
      },
      periods,
    };
  }

  /**
   * BugFix-08 (Q5): household cost overview.
   * - Lowest level: per policy the paid amount (paidToDate) and the
   *   projected monthly/annual amounts (active entry).
   * - Totals: paidToDate, month, year across all policies.
   * - `perYear`: historical costs per calendar year (sum of the full period
   *   amounts of all started periods per year - no day shares) - data
   *   basis for the historical graph.
   */
  async getHouseholdSummary(
    householdId: string,
    user: AuthenticatedUser,
    // Testability hook: "today" is the current time by default.
    now: Date = new Date(),
  ) {
    await this.assertHouseholdAccess(householdId, user.id);

    // READ_ONLY: totals only over explicitly shared policies (ADR-007/AP-16)
    const readableIds = await this.authService.getReadablePolicyIds(user, householdId);
    const where =
      user.role === GlobalRole.READ_ONLY && readableIds
        ? { householdId, archivedAt: null, id: { in: readableIds } }
        : { householdId, archivedAt: null };

    const policies = await this.db.insurancePolicy.findMany({
      where,
      include: {
        costEntries: {
          orderBy: { validFrom: 'asc' },
        },
      },
    });

    const policyRows: Array<{
      id: string;
      name: string;
      type: string;
      frequency: PaymentFrequency | null;
      paidToDate: number;
      perMonth: number;
      perYear: number;
      entryCount: number;
    }> = [];

    let totalPaidCents = 0;
    let totalPerMonthCents = 0;
    let totalPerYearCents = 0;
    const perYearMap = new Map<number, number>();

    for (const policy of policies) {
      const entries = policy.costEntries;

      if (entries.length === 0) {
        policyRows.push({
          id: policy.id,
          name: policy.insurerName,
          type: policy.type,
          frequency: null,
          paidToDate: 0,
          perMonth: 0,
          perYear: 0,
          entryCount: 0,
        });
        continue;
      }

      const paidToDate = this.calculatePaidToDate(policy, entries, now);
      // Non-null because we already continued above for entries.length === 0.
      const active = this.selectActiveOrLatestEntry(entries, now)!;
      const annual = this.annualize(active);

      totalPaidCents += toCents(paidToDate);
      totalPerYearCents += toCents(annual);
      totalPerMonthCents += toCents(roundMoney(annual / 12));

      // Historical calendar-year buckets: every started period contributes
      // its full amount to the year of its period start.
      const { anchor, frequency, stepMonths } = this.resolveBilling(policy, entries, now);
      let index = 0;
      for (;;) {
        const periodStart = addMonthsClamped(anchor, index * stepMonths);
        if (periodStart.getTime() > now.getTime()) break;
        const entry = this.entryForPeriod(entries, periodStart);
        if (entry) {
          const year = periodStart.getFullYear();
          const amountCents = toCents(this.periodAmount(entry, frequency));
          perYearMap.set(year, (perYearMap.get(year) ?? 0) + amountCents);
        }
        index++;
      }

      policyRows.push({
        id: policy.id,
        name: policy.insurerName,
        type: policy.type,
        frequency: active.frequency,
        paidToDate: roundMoney(paidToDate),
        perMonth: roundMoney(annual / 12),
        perYear: roundMoney(annual),
        entryCount: entries.length,
      });
    }

    const perYear = Array.from(perYearMap.entries())
      .map(([year, cents]) => ({ year, amount: fromCents(cents) }))
      .sort((a, b) => a.year - b.year);

    return {
      asOf: now.toISOString(),
      totals: {
        paidToDate: fromCents(totalPaidCents),
        perMonth: fromCents(totalPerMonthCents),
        perYear: fromCents(totalPerYearCents),
      },
      perYear,
      policyCount: policies.length,
      policies: policyRows,
    };
  }
}
