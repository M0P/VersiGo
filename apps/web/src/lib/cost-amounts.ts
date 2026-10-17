/**
 * BugFix-22: "Kostenerhöhung" – the gross amount is no longer mandatory.
 * At least one of gross/net must be filled in; the API enforces the same rule
 * (see `cost-tracking.service.ts`).
 */
export type CostAmountsResult =
  | { ok: true; grossAmount?: number; netAmount?: number }
  | { ok: false; reason: 'missing' | 'invalid' | 'negative' };

type ParsedAmount = number | 'empty' | 'invalid' | 'negative';

/**
 * Parses one input value. Both `.` and `,` are accepted as decimal separator
 * (German keyboards produce the comma); empty input means "not provided".
 */
function parseAmount(raw: string): ParsedAmount {
  const value = raw.trim().replace(',', '.');
  if (value === '') return 'empty';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'invalid';
  if (parsed < 0) return 'negative';
  return parsed;
}

export function parseCostAmounts(gross: string, net: string): CostAmountsResult {
  const parsedGross = parseAmount(gross);
  const parsedNet = parseAmount(net);

  if (parsedGross === 'invalid' || parsedNet === 'invalid') {
    return { ok: false, reason: 'invalid' };
  }
  if (parsedGross === 'negative' || parsedNet === 'negative') {
    return { ok: false, reason: 'negative' };
  }
  if (parsedGross === 'empty' && parsedNet === 'empty') {
    return { ok: false, reason: 'missing' };
  }

  const result: { ok: true; grossAmount?: number; netAmount?: number } = { ok: true };
  if (parsedGross !== 'empty') result.grossAmount = parsedGross;
  if (parsedNet !== 'empty') result.netAmount = parsedNet;
  return result;
}
