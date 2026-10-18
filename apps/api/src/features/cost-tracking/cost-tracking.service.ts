import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { GlobalRole, PaymentFrequency } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import { CreateCostEntryDto, UpdateCostEntryDto } from './dto/cost-tracking.dto';
import {
  computePolicySchedule,
  entryForPeriod,
  selectActiveOrLatestEntry,
  sumBasisAmounts,
  summarizePolicyCosts,
  type BasisAmounts,
  type CostEntryLike,
} from './cost-schedule';

/**
 * BugFix-08 (Q4) + BugFix-22: cost overview service.
 *
 * All calculation rules live in the pure, unit-tested domain module
 * `cost-schedule.ts` (single source of truth; the web app renders only the
 * per-basis results computed there and never calculates its own variant).
 * This service is responsible for persistence, authorization and audit only.
 *
 * BugFix-22 corrections: the period anchor is the EARLIEST of the policy
 * start and the first cost entry's validFrom (earlier cost positions are no
 * longer dropped), and gross/net are computed strictly per basis without any
 * cross-basis fallback.
 */

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
    // Same "relevant entry at a point in time" rule as the schedule
    // calculation (BugFix-22: shared domain function, no second variant).
    const predecessor = entryForPeriod(
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

    // BugFix-22: "Kostenerhöhung" – at least one of gross/net is required.
    if (dto.grossAmount == null && dto.netAmount == null) {
      throw new BadRequestException('At least one of grossAmount or netAmount is required');
    }

    // AP-24 (§4.2): a cost entry may name the billing document it was derived
    // from. The reference is checked here, not merely accepted from the
    // client: only an existing, non-archived BILLING document of this very
    // policy can be the source (the sidebar only offers those).
    if (dto.sourceDocumentId) {
      const document = await this.db.policyDocument.findFirst({
        where: { id: dto.sourceDocumentId, policyId, archivedAt: null },
        select: { id: true, documentClass: true },
      });
      if (!document) {
        throw new BadRequestException('The referenced document does not belong to this policy');
      }
      if (document.documentClass !== 'BILLING') {
        throw new BadRequestException('Only documents classified as BILLING can be a cost source');
      }
    }

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
          sourceDocumentId: dto.sourceDocumentId ?? null,
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
            sourceDocumentId: dto.sourceDocumentId ?? null,
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

  /**
   * AP-24 (§4.1): the documents of a policy classified as BILLING.
   *
   * This is the data source of the costs sidebar. Each entry names the cost
   * entries that already reference it, so the UI can mark used documents and
   * warn about duplicates without a second request per row.
   *
   * Read access is checked like everywhere else in the feature (READ_ONLY
   * only with an existing share).
   */
  async listBillingDocuments(householdId: string, user: AuthenticatedUser, policyId: string) {
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const documents = await this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null, documentClass: 'BILLING' },
      orderBy: [{ documentDate: 'desc' }, { uploadedAt: 'desc' }],
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        documentDate: true,
        storageType: true,
        storageRef: true,
        linkOriginManual: true,
        linkOriginTag: true,
        aiProcessingExcluded: true,
      },
    });

    // One query for all references instead of one per document.
    const references = await this.db.policyCostEntry.findMany({
      where: { policyId, sourceDocumentId: { not: null } },
      orderBy: { validFrom: 'desc' },
      select: { id: true, sourceDocumentId: true, validFrom: true, grossAmount: true, netAmount: true, frequency: true },
    });

    const byDocument = new Map<string, typeof references>();
    for (const reference of references) {
      if (!reference.sourceDocumentId) continue;
      const list = byDocument.get(reference.sourceDocumentId) ?? [];
      list.push(reference);
      byDocument.set(reference.sourceDocumentId, list);
    }

    return {
      documents: documents.map((document) => {
        const used = byDocument.get(document.id) ?? [];
        return {
          ...document,
          usedByCostEntries: used.map((entry) => ({
            id: entry.id,
            validFrom: entry.validFrom,
            grossAmount: entry.grossAmount,
            netAmount: entry.netAmount,
            frequency: entry.frequency,
          })),
        };
      }),
    };
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

      // BugFix-22: an update must never leave the entry without any amount.
      const nextGross = dto.grossAmount !== undefined ? dto.grossAmount : existing.grossAmount;
      const nextNet = dto.netAmount !== undefined ? dto.netAmount : existing.netAmount;
      if (nextGross == null && nextNet == null) {
        throw new BadRequestException('At least one of grossAmount or netAmount is required');
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
            // BugFix-22: a net-only entry has no gross amount – keep `null`
            // instead of `Number(null) === 0` in the audit record.
            grossAmount: existing.grossAmount == null ? null : Number(existing.grossAmount),
            netAmount: existing.netAmount == null ? null : Number(existing.netAmount),
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
   * BugFix-08 (Q4) + BugFix-22: complete cost table of a policy.
   * - `periods`: one row per billing period from the EARLIEST of policy
   *   start and first cost position until the end of the following year
   *   (past 'incurred' once started, future 'expected', projected from the
   *   currently valid entry). Amounts are strictly per basis (gross/net).
   * - `paidToDate`: per-basis sum of the full amounts of all started periods
   *   (due at period start, no day shares).
   * - `current`: annual/monthly/quarterly amounts per basis from the active
   *   entry. A basis that is not recorded anywhere stays null (UI: dash).
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

    // Horizon: end of the calendar year following the current year.
    const horizonEnd = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999);
    const schedule = computePolicySchedule(policy, entries, now, horizonEnd);

    return {
      policyId,
      asOf: now.toISOString(),
      anchor: schedule.anchor,
      frequency: schedule.frequency,
      paidToDate: schedule.paidToDate,
      current: schedule.current,
      periods: schedule.periods,
      perYear: schedule.perYear,
      entryCount: entries.length,
    };
  }

  /**
   * BugFix-08 (Q5) + BugFix-22: household cost overview.
   * - Lowest level: per policy the paid amount and the projected
   *   monthly/annual amounts - strictly per basis (gross/net, no
   *   cross-basis fallback; a missing basis stays null).
   * - Totals: paidToDate, month, year across all policies, per basis.
   * - `perYear`: historical costs per calendar year (sum of the full period
   *   amounts of all started periods per year - no day shares) per basis -
   *   data basis for the historical graph.
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
      paidToDate: BasisAmounts;
      perMonth: BasisAmounts;
      perYear: BasisAmounts;
      entryCount: number;
    }> = [];

    const paidToDateValues: BasisAmounts[] = [];
    const perMonthValues: BasisAmounts[] = [];
    const perYearValues: BasisAmounts[] = [];
    // Historical calendar-year buckets per basis: every started period
    // contributes its full amount to the year of its period start.
    const perYearBuckets = new Map<number, BasisAmounts[]>();

    for (const policy of policies) {
      const entries = policy.costEntries;
      const summary = summarizePolicyCosts(policy, entries, now);
      const active = selectActiveOrLatestEntry(entries, now);

      paidToDateValues.push(summary.paidToDate);
      perMonthValues.push(summary.perMonth);
      perYearValues.push(summary.perYear);

      if (entries.length > 0) {
        const schedule = computePolicySchedule(policy, entries, now, now);
        for (const bucket of schedule.perYear) {
          const values = perYearBuckets.get(bucket.year) ?? [];
          values.push(bucket.amount);
          perYearBuckets.set(bucket.year, values);
        }
      }

      policyRows.push({
        id: policy.id,
        name: policy.insurerName,
        type: policy.type,
        frequency: active?.frequency ?? null,
        paidToDate: summary.paidToDate,
        perMonth: summary.perMonth,
        perYear: summary.perYear,
        entryCount: entries.length,
      });
    }

    const perYear = Array.from(perYearBuckets.entries())
      .map(([year, values]) => ({ year, amount: sumBasisAmounts(values) }))
      .sort((a, b) => a.year - b.year);

    return {
      asOf: now.toISOString(),
      totals: {
        paidToDate: sumBasisAmounts(paidToDateValues),
        perMonth: sumBasisAmounts(perMonthValues),
        perYear: sumBasisAmounts(perYearValues),
      },
      perYear,
      policyCount: policies.length,
      policies: policyRows,
    };
  }
}
