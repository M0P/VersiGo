import { PaymentFrequency } from '@prisma/client';

/**
 * Cost calculation domain functions.
 *
 * Frontend and backend use the SAME logic: the web app renders only the
 * amounts computed here and never calculates its own variant. All functions
 * are pure (no DB, no clock) so every rule is unit-testable.
 *
 * Single amount field: a cost entry records exactly ONE amount. The former
 * gross/net pair (BugFix-22) was removed because an end consumer books the
 * amount they actually pay; existing rows were migrated with the gross value
 * winning over the net one.
 *
 * Rules (BugFix-08 semantics kept, BugFix-22 corrections kept):
 * - Period anchor: the EARLIEST of the policy start date and the first
 *   cost entry's validFrom. Cost positions that begin before the policy
 *   start (e.g. imported history) are no longer dropped.
 * - "Paid to date": sum of the full period amounts of all STARTED billing
 *   periods (period start <= asOf), due at period start. NO day shares.
 * - Status: a period is 'incurred' as soon as it has started
 *   (periodStart <= asOf), otherwise 'expected'.
 * - A period without a covered cost entry is `null` and rendered as a dash
 *   placeholder – it is NEVER displayed as 0.
 * - Monetary sums are formed in integer cents; results are rounded to
 *   2 decimals.
 */

/** Period length per payment frequency in months (basis of all calculations). */
export const FREQUENCY_MONTHS: Record<PaymentFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

/** Periods per year per frequency (e.g. MONTHLY = 12 -> annual amount). */
export const FREQUENCY_PER_YEAR: Record<PaymentFrequency, number> = {
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
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfMonth));
  return result;
}

/** Rounds to 2 decimals (display/single amounts). */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Amount -> integer cents (basis for loss-free sums). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer cents -> amount with 2 decimals. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** A cost entry as required by the calculation logic. */
export type CostEntryLike = {
  id?: string;
  createdAt?: Date | string | null;
  amount: unknown;
  frequency: PaymentFrequency;
  validFrom: Date;
  validTo: Date | null;
};

/**
 * An amount of a cost entry. `null` means "nothing is recorded here" – it is
 * rendered as a dash placeholder and is never replaced by 0.
 */
export type Amount = number | null;

/** Billing data of a policy (anchor + billing frequency). */
export type BillingPlan = {
  anchor: Date;
  frequency: PaymentFrequency;
  stepMonths: number;
};

/** One billing period in the cost table (incurred/expected). */
export type BillingPeriod = {
  periodIndex: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  amount: Amount;
  status: 'incurred' | 'expected';
  entryId: string | null;
};

/** Current cost entry projected per period. */
export type CurrentCosts = {
  entryId: string;
  frequency: PaymentFrequency;
  validFrom: string;
  validTo: string | null;
  /** Amount per period of the entry's own frequency. */
  amount: Amount;
  /** Annual amount (entry amount * periods per year). */
  annual: Amount;
  /** Annual amount projected to MONTHLY / QUARTERLY / ANNUAL. */
  perFrequency: Record<'MONTHLY' | 'QUARTERLY' | 'ANNUAL', Amount>;
};

export type PolicySchedule = {
  anchor: string | null;
  frequency: PaymentFrequency;
  paidToDate: Amount;
  current: CurrentCosts | null;
  periods: BillingPeriod[];
  /** Historical costs per calendar year (started periods in full). */
  perYear: { year: number; amount: Amount }[];
};

/**
 * Sums recorded values in integer cents; `null` when nothing is recorded –
 * an empty sum must never surface as 0.
 */
export function sumAmounts(values: Amount[]): Amount {
  let cents = 0;
  let recorded = false;
  for (const value of values) {
    if (value == null) continue;
    cents += toCents(value);
    recorded = true;
  }
  return recorded ? fromCents(cents) : null;
}

/** Amount of a raw cost entry; `null` when it carries no amount. */
function rawAmount(entry: CostEntryLike): Amount {
  return entry.amount != null ? Number(entry.amount) : null;
}

/**
 * Due amount of a cost entry in a billing period of the step frequency. If
 * the entry's own frequency differs from the step frequency (e.g. policy
 * MONTHLY, entry QUARTERLY), the amount is prorated to the period so that
 * the annual total stays consistent (300 QUARTERLY = 100/month).
 */
export function periodAmount(entry: CostEntryLike, stepFrequency: PaymentFrequency): Amount {
  const amount = rawAmount(entry);
  if (amount == null) return null;
  const stepMonths = FREQUENCY_MONTHS[stepFrequency];
  const entryMonths = FREQUENCY_MONTHS[entry.frequency];
  const factor = stepMonths === entryMonths ? 1 : stepMonths / entryMonths;
  return roundMoney(amount * factor);
}

/**
 * Period anchor = the EARLIEST of the policy start date and the first cost
 * entry's validFrom. This guarantees that every cost position contributes:
 * entries that begin before the policy start are no longer dropped.
 * Returns null when neither a start date nor an entry exists.
 */
export function resolveCostAnchor(
  policyStartDate: Date | null | undefined,
  entries: CostEntryLike[],
): Date | null {
  const candidates: number[] = [];
  if (policyStartDate) candidates.push(policyStartDate.getTime());
  for (const entry of entries) candidates.push(entry.validFrom.getTime());
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates));
}

/** Determines the billing plan (anchor + frequency) of a policy. */
export function resolveBilling(
  policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
  entries: CostEntryLike[],
  asOf: Date,
): BillingPlan {
  const active = selectActiveOrLatestEntry(entries, asOf);
  const anchor = resolveCostAnchor(policy.startDate, entries) ?? asOf;
  const frequency = policy.paymentFrequency ?? active?.frequency ?? PaymentFrequency.MONTHLY;
  return { anchor, frequency, stepMonths: FREQUENCY_MONTHS[frequency] };
}

/**
 * Relevant cost entry for a period: the entry with the largest
 * validFrom <= period start, unless it was explicitly ended before
 * the period start (validTo < period start).
 * Returns null if no entry exists before periodStart or the last entry
 * has already ended (cost regression/gap). For an identical validFrom
 * the newer entry wins (createdAt).
 */
export function entryForPeriod<T extends CostEntryLike>(entries: T[], periodStart: Date): T | null {
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

/** Determines the active (otherwise latest) cost entry - shared basis of the overviews. */
export function selectActiveOrLatestEntry<T extends CostEntryLike>(entries: T[], now: Date): T | null {
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
 * Generates all billing periods from the anchor to `horizonEnd` (inclusive)
 * and derives the schedule (paid to date, current entry, history).
 * A period is 'incurred' once it has started (periodStart <= asOf).
 * Empty cost entry list -> empty schedule (no periods without entries).
 */
export function computePolicySchedule(
  policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
  entries: CostEntryLike[],
  asOf: Date,
  horizonEnd: Date,
): PolicySchedule {
  if (entries.length === 0) {
    return {
      anchor: null,
      frequency:
        policy.paymentFrequency ?? entries[0]?.frequency ?? PaymentFrequency.MONTHLY,
      paidToDate: null,
      current: null,
      periods: [],
      perYear: [],
    };
  }

  const { anchor, frequency } = resolveBilling(policy, entries, asOf);
  const stepMonths = FREQUENCY_MONTHS[frequency];
  const horizonMs = horizonEnd.getTime();
  const asOfMs = asOf.getTime();

  const periods: BillingPeriod[] = [];
  const startedPeriodAmounts: Amount[] = [];
  const perYearCents = new Map<number, { cents: number; recorded: boolean }>();

  let index = 0;
  for (;;) {
    const periodStart = addMonthsClamped(anchor, index * stepMonths);
    if (periodStart.getTime() > horizonMs) break;
    const periodEndExclusive = addMonthsClamped(anchor, (index + 1) * stepMonths);
    // Inclusive period end = last moment before the next period.
    const periodEnd = new Date(periodEndExclusive.getTime() - 1);

    const entry = entryForPeriod(entries, periodStart);
    const amount = entry ? periodAmount(entry, frequency) : null;
    const started = periodStart.getTime() <= asOfMs;

    if (started) {
      startedPeriodAmounts.push(amount);
      const year = periodStart.getFullYear();
      const bucket = perYearCents.get(year) ?? { cents: 0, recorded: false };
      if (amount != null) {
        bucket.cents += toCents(amount);
        bucket.recorded = true;
      }
      perYearCents.set(year, bucket);
    }

    periods.push({
      periodIndex: index,
      periodLabel: `${String(periodStart.getMonth() + 1).padStart(2, '0')}/${periodStart.getFullYear()}`,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      amount,
      status: started ? 'incurred' : 'expected',
      entryId: entry?.id ?? null,
    });
    index++;
  }

  const active = selectActiveOrLatestEntry(entries, asOf)!;
  const raw = rawAmount(active);
  const annual = raw != null ? roundMoney(raw * FREQUENCY_PER_YEAR[active.frequency]) : null;

  return {
    anchor: anchor.toISOString(),
    frequency,
    paidToDate: sumAmounts(startedPeriodAmounts),
    current: {
      entryId: active.id!,
      frequency: active.frequency,
      validFrom: active.validFrom.toISOString(),
      validTo: active.validTo ? active.validTo.toISOString() : null,
      amount: raw,
      annual,
      perFrequency: {
        MONTHLY: annual != null ? roundMoney(annual / 12) : null,
        QUARTERLY: annual != null ? roundMoney(annual / 4) : null,
        ANNUAL: annual,
      },
    },
    periods,
    perYear: [...perYearCents.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, bucket]) => ({
        year,
        amount: bucket.recorded ? fromCents(bucket.cents) : null,
      })),
  };
}

/** Per-policy aggregates of the household cost overview. */
export type PolicyCostSummary = {
  paidToDate: Amount;
  /** Projected monthly/annual amount of the active entry. */
  perMonth: Amount;
  perYear: Amount;
};

/**
 * Household summary of ONE policy: paid to date (all started periods) plus
 * projected per-month/per-year amounts of the currently valid entry.
 */
export function summarizePolicyCosts(
  policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
  entries: CostEntryLike[],
  asOf: Date,
): PolicyCostSummary {
  if (entries.length === 0) {
    return { paidToDate: null, perMonth: null, perYear: null };
  }
  const schedule = computePolicySchedule(policy, entries, asOf, asOf);
  const annual = schedule.current?.annual ?? null;
  return {
    paidToDate: schedule.paidToDate,
    perMonth: annual != null ? roundMoney(annual / 12) : null,
    perYear: annual,
  };
}
