import { describe, it, expect } from 'vitest';
import { PaymentFrequency } from '@prisma/client';
import {
  addMonthsClamped,
  computePolicySchedule,
  entryForPeriod,
  periodBasisAmounts,
  resolveCostAnchor,
  selectActiveOrLatestEntry,
  summarizePolicyCosts,
  sumBasisAmounts,
  type CostEntryLike,
} from '../cost-schedule';

function entry(partial: Partial<CostEntryLike> & { validFrom: Date }): CostEntryLike {
  return {
    id: partial.id ?? 'e',
    grossAmount: partial.grossAmount ?? null,
    netAmount: partial.netAmount ?? null,
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
  // and 718.22 (23.10.2026), annual, net only; policy start 16.08.2026.
  const entries = [
    entry({ id: 'c1', netAmount: 701.59, validFrom: new Date('2024-10-23') }),
    entry({ id: 'c2', netAmount: 761.01, validFrom: new Date('2025-10-23') }),
    entry({ id: 'c3', netAmount: 718.22, validFrom: new Date('2026-10-23') }),
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
    expect(schedule.paidToDate).toEqual({ gross: null, net: 1462.6 });
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

  it('uses the entry amounts per basis without gross/net fallback', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);
    // Current entry at the as-of date: c3 only starts on 23.10.2026, so the
    // entry in force on 18.10.2026 is c2 (761.01, net only). Gross stays
    // null – it is never filled with the net amount.
    expect(schedule.current?.entryId).toBe('c2');
    expect(schedule.current?.amount).toEqual({ gross: null, net: 761.01 });
    expect(schedule.current?.annual).toEqual({ gross: null, net: 761.01 });
    expect(schedule.current?.perFrequency.MONTHLY).toEqual({ gross: null, net: 63.42 });
  });

  it('sums the per-year history per basis (net only here)', () => {
    const schedule = computePolicySchedule(policy, entries, asOf, horizonEnd);
    // perYear = full amounts of STARTED periods, keyed by period start year
    // (BugFix-08 rule, unchanged). On 18.10.2026 only 10/2024 and 10/2025
    // have started; 10/2026 begins after the as-of date and is therefore
    // not part of the historical series.
    expect(schedule.perYear).toEqual([
      { year: 2024, amount: { gross: null, net: 701.59 } },
      { year: 2025, amount: { gross: null, net: 761.01 } },
    ]);
  });
});

describe('computePolicySchedule (regressions of the BugFix-08 suite)', () => {
  const horizonEnd = new Date(2025, 11, 31, 23, 59, 59, 999);

  it('sums the full amounts of all started periods per basis', () => {
    // Policy billing is MONTHLY, so the positions are monthly too (100 / 150
    // per month) – identical fixture to the service-level test.
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [
        entry({ id: 'c1', grossAmount: 100, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-01-01'), validTo: new Date('2024-05-31') }),
        entry({ id: 'c2', grossAmount: 150, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-06-01') }),
      ],
      new Date('2024-12-15T12:00:00.000Z'),
      horizonEnd,
    );

    // All 12 periods of 2024 started: 5 * 100 + 7 * 150.
    expect(schedule.paidToDate.gross).toBe(5 * 100 + 7 * 150);
    expect(schedule.paidToDate.net).toBeNull();
    expect(schedule.periods[4].amount.gross).toBe(100);
    expect(schedule.periods[5].amount.gross).toBe(150);
    // Horizon runs beyond 2024 into 2025 (default horizon end is 2025-12-31).
    // In the BugFix-08 logic, periods are emitted as long as periodStart <= horizonEnd.
    expect(schedule.periods[0].periodStart).toBe('2024-01-01T00:00:00.000Z');
    expect(schedule.periods[schedule.periods.length - 1].periodStart).toBe('2025-12-01T00:00:00.000Z');
    expect(schedule.periods[11].amount.gross).toBe(150);
  });

  it('prorates entries whose frequency differs from the billing frequency', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [entry({ id: 'c1', grossAmount: 300, frequency: PaymentFrequency.QUARTERLY, validFrom: new Date('2024-01-01') })],
      new Date('2024-03-20T12:00:00.000Z'),
      horizonEnd,
    );

    expect(schedule.paidToDate.gross).toBe(300);
    for (const period of schedule.periods.slice(0, 3)) {
      expect(period.amount.gross).toBe(100);
    }
  });

  it('realigns periods after short months at the anchor (leap year 2024)', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-31'), paymentFrequency: PaymentFrequency.MONTHLY },
      [entry({ id: 'c1', grossAmount: 100, validFrom: new Date('2024-01-31') })],
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

    expect(schedule.paidToDate).toEqual({ gross: null, net: null });
    expect(schedule.current).toBeNull();
    expect(schedule.periods).toEqual([]);
    expect(schedule.perYear).toEqual([]);
  });

  it('keeps gross and net strictly separate (no cross-basis fallback)', () => {
    const schedule = computePolicySchedule(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [
        // The helper defaults to ANNUAL; without an explicit MONTHLY frequency
        // the amounts would be prorated to 10/10 respectively per period.
        entry({ id: 'c1', grossAmount: 120, netAmount: 100, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-01-01') }),
        entry({ id: 'c2', netAmount: 90, frequency: PaymentFrequency.MONTHLY, validFrom: new Date('2024-04-01') }),
      ],
      new Date('2024-06-20T12:00:00.000Z'),
      horizonEnd,
    );

    // Started periods: 01-03 gross 120 each, 04-06 gross not recorded.
    expect(schedule.paidToDate.gross).toBe(360);
    // Net: 100 for periods 01-03 and 90 for periods 04-06.
    expect(schedule.paidToDate.net).toBe(3 * 100 + 3 * 90);
    // Last period still covered by c1 reports both bases.
    expect(schedule.periods[2].amount).toEqual({ gross: 120, net: 100 });
    // A period whose entry has no gross amount reports null, not 0.
    expect(schedule.periods[3].amount).toEqual({ gross: null, net: 90 });
  });
});

describe('summarizePolicyCosts', () => {
  it('projects per month/per year from the active entry per basis', () => {
    const summary = summarizePolicyCosts(
      { startDate: new Date('2024-01-01'), paymentFrequency: PaymentFrequency.MONTHLY },
      [
        entry({ id: 'c1', grossAmount: 1200, netAmount: 1000, frequency: PaymentFrequency.ANNUAL, validFrom: new Date('2024-01-01') }),
      ],
      new Date('2024-03-01T12:00:00.000Z'),
    );

    expect(summary.perMonth).toEqual({ gross: 100, net: 83.33 });
    expect(summary.perYear).toEqual({ gross: 1200, net: 1000 });
    expect(summary.paidToDate).toEqual({ gross: 300, net: 249.99 });
  });

  it('returns null bases without entries', () => {
    const summary = summarizePolicyCosts({ startDate: null }, [], new Date());
    expect(summary).toEqual({
      paidToDate: { gross: null, net: null },
      perMonth: { gross: null, net: null },
      perYear: { gross: null, net: null },
    });
  });
});

describe('sumBasisAmounts', () => {
  it('sums recorded values per basis and keeps missing bases null', () => {
    expect(
      sumBasisAmounts([
        { gross: 10.05, net: null },
        { gross: null, net: 8.1 },
        { gross: 0.05, net: 0.9 },
      ]),
    ).toEqual({ gross: 10.1, net: 9 });
  });

  it('returns null for a basis without any recorded value', () => {
    expect(sumBasisAmounts([{ gross: null, net: 5 }, { gross: null, net: null }])).toEqual({
      gross: null,
      net: 5,
    });
  });
});

describe('periodBasisAmounts', () => {
  it('prorates each basis independently', () => {
    const amounts = periodBasisAmounts(
      entry({ grossAmount: 300, netAmount: 240, frequency: PaymentFrequency.QUARTERLY, validFrom: new Date() }),
      PaymentFrequency.MONTHLY,
    );
    expect(amounts).toEqual({ gross: 100, net: 80 });
  });

  it('keeps an unrecorded basis null', () => {
    const amounts = periodBasisAmounts(
      entry({ netAmount: 90, frequency: PaymentFrequency.ANNUAL, validFrom: new Date() }),
      PaymentFrequency.MONTHLY,
    );
    expect(amounts).toEqual({ gross: null, net: 7.5 });
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
      entry({ id: 'old', grossAmount: 100, validFrom: new Date('2024-01-01'), validTo: new Date('2024-12-31T23:59:59.999') }),
      entry({ id: 'new', grossAmount: 150, validFrom: new Date('2025-01-01') }),
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
