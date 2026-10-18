/**
 * A cost entry records exactly ONE amount – the amount the policyholder
 * actually pays. The former gross/net pair was removed together with its
 * "at least one of the two" rule; the amount is simply mandatory.
 *
 * The form uses this pure helper so the rule is testable without a DOM; the
 * API enforces the same rule (see `cost-tracking.service.ts`).
 */
export type CostAmountResult =
  | { ok: true; amount: number }
  | { ok: false; reason: 'missing' | 'invalid' | 'negative' };

/**
 * Parses the amount input. Both `.` and `,` are accepted as decimal
 * separator (German keyboards produce the comma); empty input means "not
 * provided" and is rejected – an entry without an amount would contribute
 * nothing to any sum.
 */
export function parseCostAmount(raw: string): CostAmountResult {
  const value = raw.trim().replace(',', '.');
  if (value === '') return { ok: false, reason: 'missing' };

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false, reason: 'invalid' };
  if (parsed < 0) return { ok: false, reason: 'negative' };

  return { ok: true, amount: parsed };
}
