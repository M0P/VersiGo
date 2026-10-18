import { describe, it, expect } from 'vitest';
import { parseCostAmounts } from '../lib/cost-amounts';

/**
 * BugFix-22: the gross amount is no longer a mandatory field – at least one
 * of gross/net must be provided. The form uses this pure helper so the rule
 * is testable without a DOM.
 */
describe('parseCostAmounts (BugFix-22: gross OR net required)', () => {
  it('rejects a form where both amounts are empty', () => {
    expect(parseCostAmounts('', '')).toEqual({ ok: false, reason: 'missing' });
    expect(parseCostAmounts('   ', '  ')).toEqual({ ok: false, reason: 'missing' });
  });

  it('accepts a gross amount only', () => {
    expect(parseCostAmounts('1200', '')).toEqual({ ok: true, grossAmount: 1200 });
  });

  it('accepts a net amount only', () => {
    expect(parseCostAmounts('', '1000')).toEqual({ ok: true, netAmount: 1000 });
  });

  it('accepts both amounts', () => {
    expect(parseCostAmounts('1200', '1000')).toEqual({
      ok: true,
      grossAmount: 1200,
      netAmount: 1000,
    });
  });

  it('accepts the value 0 as a provided amount', () => {
    expect(parseCostAmounts('0', '')).toEqual({ ok: true, grossAmount: 0 });
  });

  it('rejects non-numeric input', () => {
    expect(parseCostAmounts('abc', '')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCostAmounts('1200', 'abc')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects negative input', () => {
    expect(parseCostAmounts('-5', '')).toEqual({ ok: false, reason: 'negative' });
    expect(parseCostAmounts('', '-5')).toEqual({ ok: false, reason: 'negative' });
  });

  it('parses decimal values with comma or dot', () => {
    expect(parseCostAmounts('1200,50', '')).toEqual({ ok: true, grossAmount: 1200.5 });
    expect(parseCostAmounts('1200.50', '')).toEqual({ ok: true, grossAmount: 1200.5 });
  });
});
