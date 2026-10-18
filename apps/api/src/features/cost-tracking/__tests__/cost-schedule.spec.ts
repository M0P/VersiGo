import { describe, it, expect } from 'vitest';
import { PaymentFrequency } from '@prisma/client';
import {
  addMonthsClamped,
  computePolicySchedule,
  entryForPeriod,
  periodAmount,
  resolveCostAnchor,
  selectActiveOrLatestEntry,
  summarizePolicyCosts,
  sumAmounts,
  type CostEntryLike,
} from '../cost-schedule';

function entry(partial: Partial<CostEntryLike> & { validFrom: Date }): CostEntryLike {
  return {
    id: partial.id ?? 'e',
    amount: partial.amount ?? null,
    frequency: partial.frequency ?? PaymentFrequency.ANNUAL,
    validFrom: partial.validFrom,
    validTo: partial.validTo ?? null,
  };
}

describe('resolveCostAnchor (BugFix-22)', () => {
  it('uses the EARLIEST of policy start and first entry validFrom', () => {
    // Bug report dataset: policy starts 16.08.2026, first cost position
    // already exists since 23.10.2024 -> anchor must be 23.10.2024 so the
    // earlier periods are no longer dropped.
    const anchor = resolveCostAnchor(new Date('2026-08-16'), [
      entry({ validFrom: new Date('2024-10-23') }),
    ]);
    expect(anchor?.toISOString()).toBe(new Date('2024-10-23').toISOString());
  });

  it('uses the policy start when it precedes all entries', () => {
    const anchor = resolveCostAnchor(new Date('2024-01-01'), [
      entry({ validFrom: new Date('2024-03-01') }),
    ]);
    expect(anchor?.toISOString()).toBe(new Date('2024-01-01').toISOString());
  });

  it('returns null without start date and without entries', () => {
    expect(resolveCostAnchor(null, [])).toBeNull();
  });
});

describe('computePolicySchedule (BugFix-22 acceptance dataset)', () => {
  // Reported defect: cost positions 701.59 (23.10.2024), 761.01 (23.10.2025)
  // and 718.22 (23.10.2026), annual; policy start 16.08.2026. The amounts
  // used to be recorded net-only; with the single amount field they are plain
  // amounts.
  const entries = [
    entry({ id: 'c1', amount: 701.59, validFrom: new Date('2024-10-23') }),
    entry({ id: 'c2', amount: 761.01, validFrom: new Date('2025-10-23') }),
    entry({ id: 'c3', amount: 718.22, validFrom: new Date('2026-10-23') }),
  ];
  const policy = {
    startDate: new Date('2026-08-16'),
    paymentFrequency: PaymentFrequency.ANNUAL,
  };
  const asOf = new Date('2026-10-18T09:00:00.000Z');
  const horizonEnd = new Date(2027, 11, 31, 23, 59, 59, 999);

  it('contains all periods from the first cost position', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);

    expect(schedule.periods.map((p) => p.periodStart)).toEqual([
      new Date('2024-10-23').toISOString(),
      new Date('2025-10-23').toISOString(),
      new Date('2026-10-23').toISOString(),
      new Date('2027-10-23').toISOString(),
    ]);
    // BugFix-08 semantics (unchanged): the loop emits every period whose
    // START lies within the horizon; the last emitted period keeps its full
    // billing length instead of being truncated at the horizon. No period
    // may start beyond the horizon.
    expect(schedule.periods[3].periodEnd).toBe('2028-10-22T23:59:59.999Z');
    expect(
      schedule.periods.every((p) => new Date(p.periodStart).getTime() <= horizonEnd.getTime()),
    ).toBe(true);
    expect(schedule.periods.map((p) => p.entryId)).toEqual(['c1', 'c2', 'c3', 'c3']);
  });

  it('sums all started periods: paid to date = 701.59 + 761.01 = 1462.60', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);
    expect(schedule.paidToDate).toBe(1462.6);
  });

  it('marks started periods as incurred and future periods as expected', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);
    expect(schedule.periods.map((p) => p.status)).toEqual([
      'incurred',
      'incurred',
      'expected',
      'expected',
    ]);
  });

  it('uses the entry amount of the entry in force on the as-of date', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);
    // Current entry at the as-of date: c3 only starts on 23.10.2026, so the
    // entry in force on 18.10.2026 is c2 (761.01).
    expect(schedule.current?.entryId).toBe('c2');
    expect(schedule.current?.amount).toBe(761.01);
    expect(schedule.current?.annual).toBe(761.01);
    expect(schedule.current?.perFrequency.MONTHLY).toBe(63.42);
  });

  it('sums the per-year history (started periods in full)', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);
    // perYear = full amounts of STARTED periods, keyed by period start year
    // (BugFix-08 rule, unchanged). On 18.10.2026 only 10/2024 and 10/2025
    // have started; 10/2026 begins after the as-of date and is therefore
    // not part of the historical series.
    expect(schedule.perYear).toEqual([
      { year: 2024, amount: 701.59 },
      { year: 2025, amount: 761.01 },
    ]);
  });
});

describe('computePolicySchedule (regressions of the BugFix-08 suite)', () => {
  const horizonEnd = new Date(2025, 11, 31, 23, 59, 59, 999);

  it('sums the full amounts of all started periods', () => {
    // Policy billing is MONTHLY, so the positions are monthly too (100 / 150
    // per month) – identical fixture to the service-level test.
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [
        entry({ id: 'c1', amount: 100, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-01-01'), validTo: new Date('2024-05-31') }),
        entry({ id: 'c2', amount: 150, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-06-01') }),
      ],
      new Date('2024-12-15T12:00:00.000Z'),
      horizonEnd,
    );

    // All 12 periods of 2024 started: 5 * 100 + 7 * 150.
    expect(schedule.paidToDate).toBe(5 * 100 + 7 * 150);
    expect(schedule.periods[4].amount).toBe(100);
    expect(schedule.periods[5].amount).toBe(150);
    // Horizon runs beyond 2024 into 2025 (default horizon end is 2025-12-31).
    // In the BugFix-08 logic, periods are emitted as long as periodStart <= horizonEnd.
    expect(schedule.periods[0].periodStart).toBe('2024-01-01T00:00:00.000Z');
    expect(schedule.periods[schedule.periods.length - 1].periodStart).toBe('2025-12-01T00:00:00.000Z');
    expect(schedule.periods[11].amount).toBe(150);
  });

  it('prorates entries whose frequency differs from the billing frequency', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [entry({ id: 'c1', amount: 300, frequency: PaymentFrequency.QUARTERLY, validFrom: new Date('2024-01-01') })],
      new Date('2024-03-20T12:00:00.000Z'),
      horizonEnd,
    );

    expect(schedule.paidToDate).toBe(300);
    for (const period of schedule.periods.slice(0, 3)) {
      expect(period.amount).toBe(100);
    }
  });

  it('realigns periods after short months at the anchor (leap year 2024)', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-31'), paymentFrequency: PaymentFrequency.MONTHLY },
      [entry({ id: 'c1', amount: 100, validFrom: new Date('2024-01-31') })],
      new Date('2024-03-31T12:00:00.000Z'),
      horizonEnd,
    );

    expect(schedule.periods[0].periodStart).toBe('2024-01-31T00:00:00.000Z');
    expect(schedule.periods[1].periodStart).toBe('2024-02-29T00:00:00.000Z');
    expect(schedule.periods[2].periodStart).toBe('2024-03-31T00:00:00.000Z');
  });

  it('returns an empty schedule without cost entries', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-15'), paymentFrequency: PaymentFrequency.MONTHLY },
      [],
      new Date('2024-03-20T12:00:00.000Z'),
      horizonEnd,
    );

    expect(schedule.paidToDate).toBeNull();
    expect(schedule.current).toBeNull();
    expect(schedule.periods).toEqual([]);
    expect(schedule.perYear).toEqual([]);
  });

  it('keeps a period without a recorded amount null instead of 0', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [
        entry({ id: 'c1', amount: 120, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-01-01'), validTo: new Date('2024-03-31') }),
      ],
      new Date('2024-06-20T12:00:00.000Z'),
      horizonEnd,
    );

    // Periods 01-03 are covered by c1; from 04 on no entry exists any more.
    expect(schedule.periods[2].amount).toBe(120);
    expect(schedule.periods[3].amount).toBeNull();
    expect(schedule.paidToDate).toBe(360);
  });
});

describe('summarizePolicyCosts', () => {
  it('projects per month/per year from the active entry', () => {
    const summary = summarizePolicyCosts(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [
        entry({ id: 'c1', amount: 1200, frequency: PaymentFrequency.ANNUAL, validFrom: new Date('2024-01-01') }),
      ],
      new Date('2024-03-01T12:00:00.000Z'),
    );

    expect(summary.perMonth).toBe(100);
    expect(summary.perYear).toBe(1200);
    expect(summary.paidToDate).toBe(300);
  });

  it('returns null without entries', () => {
    const summary = summarizePolicyCosts({ startDate: null }, [], new Date());
    expect(summary).toEqual({ paidToDate: null, perMonth: null, perYear: null });
  });
});

describe('sumAmounts', () => {
  it('sums recorded values as integer cents and rounds to 2 decimals', () => {
    expect(sumAmounts([10.05, 0.05, null])).toBe(10.1);
  });

  it('returns null when nothing is recorded (never 0)', () => {
    expect(sumAmounts([null, null])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(sumAmounts([])).toBeNull();
  });

  it('treats a recorded 0 as a recorded value', () => {
    expect(sumAmounts([0, null])).toBe(0);
  });
});

describe('periodAmount', () => {
  it('prorates the amount to the step frequency', () => {
    const amount = periodAmount(
      entry({ amount: 300, frequency: PaymentFrequency.QUARTERLY, validFrom: new Date() }),
      PaymentFrequency.MONTHLY,
    );
    expect(amount).toBe(100);
  });

  it('keeps an unrecorded amount null', () => {
    const amount = periodAmount(
      entry({ amount: null, frequency: PaymentFrequency.ANNUAL, validFrom: new Date() }),
      PaymentFrequency.MONTHLY,
    );
    expect(amount).toBeNull();
  });
});

describe('addMonthsClamped', () => {
  it('clamps to the last day of the target month', () => {
    expect(addMonthsClamped(new Date(2024, 0, 31), 1).getDate()).toBe(29); // leap year
    expect(addMonthsClamped(new Date(2025, 0, 31), 1).getDate()).toBe(28);
    expect(addMonthsClamped(new Date(2024, 0, 31), 2).getDate()).toBe(31);
  });
});

describe('entryForPeriod / selectActiveOrLatestEntry', () => {
  it('selects the newest entry valid at the period start', () => {
    const entries = [
      entry({ id: 'old', amount: 100, validFrom: new Date('2024-01-01'), validTo: new Date('2024-12-31T23:59:59.999') }),
      entry({ id: 'new', amount: 150, validFrom: new Date('2025-01-01') }),
    ];
    expect(entryForPeriod(entries, new Date('2024-06-01'))?.id).toBe('old');
    expect(entryForPeriod(entries, new Date('2025-06-01'))?.id).toBe('new');
    expect(entryForPeriod(entries, new Date('2023-06-01'))).toBeNull();
  });

  it('falls back to the latest entry when none is active', () => {
    const entries = [
      entry({ id: 'a', validFrom: new Date('2024-01-01'), validTo: new Date('2024-06-30') }),
      entry({ id: 'b', validFrom: new Date('2024-09-01'), validTo: new Date('2024-10-31') }),
    ];
    expect(selectActiveOrLatestEntry(entries, new Date('2024-08-01'))?.id).toBe('b');
    expect(selectActiveOrLatestEntry([], new Date())).toBeNull();
  });
});
