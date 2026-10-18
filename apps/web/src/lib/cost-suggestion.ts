/**
 * AP-24 (§4.2): names of the fields a cost-extraction proposal may mark as
 * unreliable.
 *
 * The same list is part of the server-side schema
 * (`COST_EXTRACTION_FIELDS` in `cost-extraction-format.ts`). Fields the form
 * cannot show (`currency`, `invoiceDate`) are kept in the type so the
 * validator output stays comparable; the rendering only highlights the
 * matching inputs.
 */
export const COST_SUGGESTION_FIELDS = [
  'amount',
  'currency',
  'invoiceDate',
  'validFrom',
  'validTo',
  'frequency',
  'bookingSource',
  'description',
] as const;

export type CostSuggestionField = (typeof COST_SUGGESTION_FIELDS)[number];

/**
 * Keeps only known field names, deduplicated and in the stable order of
 * `COST_SUGGESTION_FIELDS`. Unknown names are dropped – an unexpected token
 * must never end up in the UI.
 */
export function knownCostSuggestionFields(value: unknown): CostSuggestionField[] {
  if (!Array.isArray(value)) return [];
  const reported = value.filter((entry): entry is string => typeof entry === 'string');
  return COST_SUGGESTION_FIELDS.filter((field) => reported.includes(field));
}

/**
 * AP-24 (§4.2): maps a validated AI cost suggestion onto the cost form.
 *
 * The API only ever returns a *proposal* that was validated against the
 * versioned schema (`packages/foundation/src/ai/cost-extraction-format.ts`).
 * This module turns it into the strings the form uses and collects the notices
 * the user has to see before saving. It is pure and has no i18n dependency:
 * notices are returned as message keys so the same logic can be tested and the
 * rendering stays translated.
 *
 * Rules:
 * - uncertain values are never filled in (no guessing on top of the model),
 * - a credit note keeps its positive amount (cost entries store amounts >= 0)
 *   and is reported as a notice instead,
 * - unknown `unclearFields` entries are dropped.
 */

export interface CostExtractionSuggestion {
  version: number;
  amount: number | null;
  currency: string | null;
  isCredit: boolean;
  invoiceDate: string | null;
  validFrom: string | null;
  validTo: string | null;
  frequency: string | null;
  bookingSource: string | null;
  description: string;
  confidence: string;
  unclearFields: string[];
  notes: string | null;
}

/** A message key plus its interpolation values. */
export interface CostPrefillNotice {
  key: string;
  params?: Record<string, string>;
}

/** Prefill for the create form of the costs card. */
export interface CostEntryPrefill {
  /** Changes with every suggestion – the same document can be used again. */
  token: string;
  validFrom: string;
  validTo: string;
  /** The amount read from the billing document; '' when none was read. */
  amount: string;
  /** Creatable frequency of the suggestion; `null` when it must be chosen. */
  frequency: string | null;
  bookingSource: string;
  note: string;
  /** Billing document the proposal came from (stored with the entry). */
  sourceDocumentId: string;
  /** Fields the model could not read reliably (highlighted in the form). */
  unclearFields: CostSuggestionField[];
  notices: CostPrefillNotice[];
}

/** Frequencies a NEW cost entry may have (SEMI_ANNUAL is legacy only). */
const CREATABLE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];

/**
 * A frequency the form may preselect. `SEMI_ANNUAL` cannot be created any
 * more (BugFix-08), so it is reported instead of preselected – the user picks
 * a creatable one.
 */
export function creatablePrefillFrequency(frequency: string | null): {
  frequency: string | null;
  notice: CostPrefillNotice | null;
} {
  if (!frequency) return { frequency: null, notice: null };
  if (CREATABLE_FREQUENCIES.includes(frequency)) return { frequency, notice: null };
  return { frequency: null, notice: { key: 'costs.aiNoticeLegacyFrequency' } };
}

function joinNoteParts(parts: (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(' · ');
}

/**
 * Builds the prefill for the cost form.
 *
 * `existingEntryCount` is the number of cost entries already linked to this
 * document – shown as a duplicate warning, without preventing the entry
 * (the user may genuinely book a second partial amount).
 */
export function buildCostEntryPrefill(
  suggestion: CostExtractionSuggestion,
  sourceDocumentId: string,
  token: string,
  existingEntryCount = 0,
): CostEntryPrefill {
  const notices: CostPrefillNotice[] = [];

  if (existingEntryCount > 0) {
    notices.push({ key: 'costs.aiNoticeExistingEntries', params: { count: String(existingEntryCount) } });
  }
  if (suggestion.isCredit) {
    // A cost entry stores positive amounts, so a credit note is booked as a
    // positive amount – the user has to decide whether that is correct here.
    notices.push({ key: 'costs.aiNoticeCredit' });
  }
  if (suggestion.confidence === 'low') {
    notices.push({ key: 'costs.aiNoticeLowConfidence' });
  }
  if (suggestion.notes) {
    notices.push({ key: 'costs.aiNoticeModelNotes', params: { notes: suggestion.notes } });
  }
  if (suggestion.currency && suggestion.currency !== 'EUR') {
    notices.push({ key: 'costs.aiNoticeForeignCurrency', params: { currency: suggestion.currency } });
  }
  if (suggestion.unclearFields.length > 0) {
    notices.push({ key: 'costs.aiNoticeUnclearFields' });
  }

  const { frequency, notice: frequencyNotice } = creatablePrefillFrequency(suggestion.frequency);
  if (frequencyNotice) notices.push(frequencyNotice);

  return {
    token,
    // The covered period start is the better anchor for a cost entry; without
    // one the invoice date is used, otherwise the field stays empty for the
    // user to fill in.
    validFrom: suggestion.validFrom ?? suggestion.invoiceDate ?? '',
    validTo: suggestion.validTo ?? '',
    amount: suggestion.amount !== null ? String(suggestion.amount) : '',
    frequency,
    bookingSource: suggestion.bookingSource ?? '',
    note: joinNoteParts([suggestion.description, suggestion.invoiceDate, suggestion.notes]),
    sourceDocumentId,
    unclearFields: knownCostSuggestionFields(suggestion.unclearFields),
    notices,
  };
}
