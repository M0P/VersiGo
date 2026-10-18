import { describe, it, expect } from 'vitest';
import { parseCostAmount } from '../lib/cost-amounts';

/**
 * A cost entry records exactly ONE amount – the amount the policyholder
 * actually pays. The form uses this pure helper so the mandatory-amount rule
 * is testable without a DOM.
 */
describe('parseCostAmount (single amount field)', () => {
  it('rejects an empty input – an entry without an amount is invalid', () => {
    expect(parseCostAmount('')).toEqual({ ok: false, reason: 'missing' });
    expect(parseCostAmount('   ')).toEqual({ ok: false, reason: 'missing' });
  });

  it('accepts a positive amount', () => {
    expect(parseCostAmount('1200')).toEqual({ ok: true, amount: 1200 });
  });

  it('accepts the value 0 as a provided amount', () => {
    expect(parseCostAmount('0')).toEqual({ ok: true, amount: 0 });
  });

  it('rejects non-numeric input', () => {
    expect(parseCostAmount('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCostAmount('12.34.56')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects negative input', () => {
    expect(parseCostAmount('-5')).toEqual({ ok: false, reason: 'negative' });
  });

  it('parses decimal values with comma or dot', () => {
    expect(parseCostAmount('1200,50')).toEqual({ ok: true, amount: 1200.5 });
    expect(parseCostAmount('1200.50')).toEqual({ ok: true, amount: 1200.5 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseCostAmount(' 12,50 ')).toEqual({ ok: true, amount: 12.5 });
  });
});
