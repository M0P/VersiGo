import { PaymentFrequency } from '@prisma/client';

/**
 * BugFix-22: central, pure domain function for the cost calculation.
 *
 * Frontend and backend use the SAME logic: the web app renders only the
 * per-basis amounts computed here and never calculates its own variant.
 * All functions are pure (no DB, no clock) so every rule is unit-testable.
 *
 * Rules (BugFix-08 semantics kept, BugFix-22 corrections):
 * - Period anchor: the EARLIEST of the policy start date and the first
 *   cost entry's validFrom. Cost positions that begin before the policy
 *   start (e.g. imported history) are no longer dropped.
 * - "Paid to date": sum of the full period amounts of all STARTED billing
 *   periods (period start <= asOf), due at period start. NO day shares.
 * - Status: a period is 'incurred' as soon as it has started
 *   (periodStart <= asOf), otherwise 'expected'.
 * - Gross and net are computed STRICTLY SEPARATE per basis. There is no
 *   gross -> net fallback: an entry without a net amount contributes
 *   nothing to net sums and vice versa. Missing bases render as null
 *   (UI shows a dash placeholder).
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
  grossAmount: unknown;
  netAmount?: unknown;
  frequency: PaymentFrequency;
  validFrom: Date;
  validTo: Date | null;
};

/**
 * BugFix-22: an amount per basis. `null` means "this basis is not recorded
 * here" - it is NEVER replaced by the other basis. The UI renders null as
 * a dash placeholder; sums only aggregate recorded values of their basis.
 */
export type BasisAmounts = {
  gross: number | null;
  net: number | null;
};

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
  amount: BasisAmounts;
  status: 'incurred' | 'expected';
  entryId: string | null;
};

/** Current cost entry projected per period/per basis. */
export type CurrentCosts = {
  entryId: string;
  frequency: PaymentFrequency;
  validFrom: string;
  validTo: string | null;
  /** Amount per period of the entry's own frequency, per basis. */
  amount: BasisAmounts;
  /** Annual amount (entry amount * periods per year), per basis. */
  annual: BasisAmounts;
  /** Annual amount projected to MONTHLY / QUARTERLY / ANNUAL, per basis. */
  perFrequency: Record<'MONTHLY' | 'QUARTERLY' | 'ANNUAL', BasisAmounts>;
};

export type PolicySchedule = {
  anchor: string | null;
  frequency: PaymentFrequency;
  paidToDate: BasisAmounts;
  current: CurrentCosts | null;
  periods: BillingPeriod[];
  /** Historical costs per calendar year (started periods in full). */
  perYear: { year: number; amount: BasisAmounts }[];
};

/** Sums recorded values per basis; a basis stays null when nothing is recorded. */
export function sumBasisAmounts(values: BasisAmounts[]): BasisAmounts {
  let grossCents = 0;
  let netCents = 0;
  let grossRecorded = false;
  let netRecorded = false;
  for (const value of values) {
    if (value.gross != null) {
      grossCents += toCents(value.gross);
      grossRecorded = true;
    }
    if (value.net != null) {
      netCents += toCents(value.net);
      netRecorded = true;
    }
  }
  return {
    gross: grossRecorded ? fromCents(grossCents) : null,
    net: netRecorded ? fromCents(netCents) : null,
  };
}

/** Basis amounts of a raw entry amount pair (no cross-basis fallback). */
function rawBasisAmounts(entry: CostEntryLike): BasisAmounts {
  return {
    gross: entry.grossAmount != null ? Number(entry.grossAmount) : null,
    net: entry.netAmount != null ? Number(entry.netAmount) : null,
  };
}

/**
 * Due amount of one basis of a cost entry in a billing period of the step
 * frequency. If the entry's own frequency differs from the step frequency
 * (e.g. policy MONTHLY, entry QUARTERLY), the amount is prorated to the
 * period so that the annual total stays consistent (300 QUARTERLY = 100/month).
 * A basis without a recorded amount stays null.
 */
export function periodBasisAmounts(
  entry: CostEntryLike,
  stepFrequency: PaymentFrequency,
): BasisAmounts {
  const stepMonths = FREQUENCY_MONTHS[stepFrequency];
  const entryMonths = FREQUENCY_MONTHS[entry.frequency];
  const factor = stepMonths === entryMonths ? 1 : stepMonths / entryMonths;
  const raw = rawBasisAmounts(entry);
  return {
    gross: raw.gross != null ? roundMoney(raw.gross * factor) : null,
    net: raw.net != null ? roundMoney(raw.net * factor) : null,
  };
}

/**
 * BugFix-22: period anchor = the EARLIEST of the policy start date and the
 * first cost entry's validFrom. This guarantees that every cost position
 * contributes: entries that begin before the policy start are no longer
 * dropped. Returns null when neither a start date nor an entry exists.
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
 * and derives the per-basis schedule (paid to date, current entry, history).
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
      paidToDate: { gross: null, net: null },
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
  const startedPeriodAmounts: BasisAmounts[] = [];
  const perYearCents = new Map<number, { grossCents: number; netCents: number; gross: boolean; net: boolean }>();

  let index = 0;
  for (;;) {
    const periodStart = addMonthsClamped(anchor, index * stepMonths);
    if (periodStart.getTime() > horizonMs) break;
    const periodEndExclusive = addMonthsClamped(anchor, (index + 1) * stepMonths);
    // Inclusive period end = last moment before the next period.
    const periodEnd = new Date(periodEndExclusive.getTime() - 1);

    const entry = entryForPeriod(entries, periodStart);
    const amount = entry
      ? periodBasisAmounts(entry, frequency)
      : { gross: null, net: null };
    const started = periodStart.getTime() <= asOfMs;

    if (started) {
      startedPeriodAmounts.push(amount);
      const year = periodStart.getFullYear();
      const bucket = perYearCents.get(year) ?? { grossCents: 0, netCents: 0, gross: false, net: false };
      if (amount.gross != null) {
        bucket.grossCents += toCents(amount.gross);
        bucket.gross = true;
      }
      if (amount.net != null) {
        bucket.netCents += toCents(amount.net);
        bucket.net = true;
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
  const rawActive = rawBasisAmounts(active);
  const annualize = (value: number | null): number | null =>
    value != null ? roundMoney(value * FREQUENCY_PER_YEAR[active.frequency]) : null;
  const annual: BasisAmounts = {
    gross: annualize(rawActive.gross),
    net: annualize(rawActive.net),
  };

  return {
    anchor: anchor.toISOString(),
    frequency,
    paidToDate: sumBasisAmounts(startedPeriodAmounts),
    current: {
      entryId: active.id!,
      frequency: active.frequency,
      validFrom: active.validFrom.toISOString(),
      validTo: active.validTo ? active.validTo.toISOString() : null,
      amount: rawActive,
      annual,
      perFrequency: {
        MONTHLY: {
          gross: annual.gross != null ? roundMoney(annual.gross / 12) : null,
          net: annual.net != null ? roundMoney(annual.net / 12) : null,
        },
        QUARTERLY: {
          gross: annual.gross != null ? roundMoney(annual.gross / 4) : null,
          net: annual.net != null ? roundMoney(annual.net / 4) : null,
        },
        ANNUAL: { gross: annual.gross, net: annual.net },
      },
    },
    periods,
    perYear: [...perYearCents.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, bucket]) => ({
        year,
        amount: {
          gross: bucket.gross ? fromCents(bucket.grossCents) : null,
          net: bucket.net ? fromCents(bucket.netCents) : null,
        },
      })),
  };
}

/** Per-policy aggregates of the household cost overview (per basis). */
export type PolicyCostSummary = {
  paidToDate: BasisAmounts;
  /** Projected monthly/annual amount of the active entry, per basis. */
  perMonth: BasisAmounts;
  perYear: BasisAmounts;
};

/**
 * Household summary of ONE policy: paid to date (all started periods) plus
 * projected per-month/per-year amounts of the currently valid entry - all
 * strictly per basis (BugFix-22).
 */
export function summarizePolicyCosts(
  policy: { startDate?: Date | null; paymentFrequency?: PaymentFrequency | null },
  entries: CostEntryLike[],
  asOf: Date,
): PolicyCostSummary {
  if (entries.length === 0) {
    return {
      paidToDate: { gross: null, net: null },
      perMonth: { gross: null, net: null },
      perYear: { gross: null, net: null },
    };
  }
  const schedule = computePolicySchedule(policy, entries, asOf, asOf);
  const annual = schedule.current?.annual ?? { gross: null, net: null };
  return {
    paidToDate: schedule.paidToDate,
    perMonth: {
      gross: annual.gross != null ? roundMoney(annual.gross / 12) : null,
      net: annual.net != null ? roundMoney(annual.net / 12) : null,
    },
    perYear: annual,
  };
}
