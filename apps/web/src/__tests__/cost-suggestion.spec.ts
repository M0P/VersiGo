import { describe, it, expect } from 'vitest';

import {
  buildCostEntryPrefill,
  creatablePrefillFrequency,
  knownCostSuggestionFields,
  COST_SUGGESTION_FIELDS,
  type CostExtractionSuggestion,
} from '../lib/cost-suggestion';

function suggestion(partial: Partial<CostExtractionSuggestion>): CostExtractionSuggestion {
  return {
    version: 1,
    amount: null,
    currency: 'EUR',
    isCredit: false,
    invoiceDate: null,
    validFrom: null,
    validTo: null,
    frequency: null,
    bookingSource: null,
    description: '',
    confidence: 'high',
    unclearFields: [],
    notes: null,
    ...partial,
  };
}

describe('cost-suggestion prefill', () => {
  it('falls back from validFrom to invoiceDate and never derives netAmount', () => {
    const prefill = buildCostEntryPrefill(
      suggestion({
        amount: 120,
        invoiceDate: '2026-10-18',
        frequency: 'ANNUAL',
        validFrom: null,
      }),
      'doc1',
      'tok1',
    );
    expect(prefill.validFrom).toBe('2026-10-18');
    expect(prefill.netAmount).toBe('');
    expect(prefill.grossAmount).toBe('120');
    expect(prefill.frequency).toBe('ANNUAL');
    expect(prefill.sourceDocumentId).toBe('doc1');
    expect(prefill.token).toBe('tok1');
  });

  it('reports credit notes, existing entries and legacy frequency', () => {
    const prefill = buildCostEntryPrefill(
      suggestion({
        amount: 60,
        invoiceDate: '2026-10-01',
        frequency: 'SEMI_ANNUAL',
        isCredit: true,
        unclearFields: ['amount'],
      }),
      'doc1',
      'tok1',
      3,
    );
    const keys = prefill.notices.map((notice) => notice.key);
    expect(keys).toContain('costs.aiNoticeCredit');
    expect(keys).toContain('costs.aiNoticeExistingEntries');
    expect(keys).toContain('costs.aiNoticeLegacyFrequency');
    expect(prefill.frequency).toBeNull();
    expect(prefill.unclearFields).toEqual(['amount']);
  });

  it('drops unknown unclear fields', () => {
    expect(knownCostSuggestionFields(['amount', 'unknownField', 'amount'])).toEqual(['amount']);
    expect(COST_SUGGESTION_FIELDS).toContain('frequency');
    expect(buildCostEntryPrefill(
      suggestion({ amount: 50, unclearFields: ['amount', 'unknownField'] }),
      'doc1',
      'tok1',
    ).unclearFields).toEqual(['amount']);
  });

  it('collects notes and foreign currency', () => {
    const prefill = buildCostEntryPrefill(
      suggestion({ amount: 50, currency: 'USD', notes: 'Hinweis', description: 'Beitrag' }),
      'doc1',
      'tok1',
    );
    const keys = prefill.notices.map((notice) => notice.key);
    expect(keys).toContain('costs.aiNoticeForeignCurrency');
    expect(keys).toContain('costs.aiNoticeModelNotes');
    expect(prefill.note).toContain('Beitrag');
    expect(prefill.note).toContain('Hinweis');
  });

  it('creatablePrefillFrequency allows creatable ones and rejects legacy', () => {
    expect(creatablePrefillFrequency('MONTHLY').frequency).toBe('MONTHLY');
    expect(creatablePrefillFrequency('SEMI_ANNUAL')).toEqual({
      frequency: null,
      notice: { key: 'costs.aiNoticeLegacyFrequency' },
    });
  });
});
