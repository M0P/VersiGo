import { describe, it, expect } from 'vitest';
import {
  COVERAGE_SUMMARY_MAX_TOTAL_LENGTH,
  COVERAGE_SUMMARY_SCHEMA_VERSION,
  COVERAGE_SUMMARY_SYSTEM_PROMPT,
  buildCoverageSummaryRepairHint,
  coverageSummaryContentLength,
  coverageSummaryToPlainText,
  parseCoverageSummary,
  validateCoverageSummary,
  type CoverageSummaryDocument,
  type CoverageSummarySection,
} from '../coverage-summary-format';

/**
 * Builds a document whose text content has roughly `length` characters.
 *
 * The content is spread over several sections because the schema allows at
 * most 8 sections with 12 items each – a single long section would be
 * rejected by the structural rules before the total budget could apply.
 */
function documentWithContentLength(
  length: number,
  version: number = COVERAGE_SUMMARY_SCHEMA_VERSION,
): CoverageSummaryDocument {
  const itemLength = 50;
  const maxSections = 8;
  const maxItemsPerSection = 12;
  const totalItems = Math.max(1, Math.ceil(length / itemLength));
  const sectionCount = Math.min(maxSections, Math.ceil(totalItems / maxItemsPerSection));

  const sections: CoverageSummarySection[] = [];
  let remaining = totalItems;
  for (let index = 0; index < sectionCount; index += 1) {
    const itemsHere = Math.min(maxItemsPerSection, Math.ceil(remaining / (sectionCount - index)));
    sections.push({
      title: 'Deckung',
      items: Array.from({ length: itemsHere }, () => 'x'.repeat(itemLength)),
      note: null,
    });
    remaining -= itemsHere;
  }

  return { version, sections, hints: [] };
}

describe('coverage-summary-format', () => {
  it('versions the format (prompt contract) as 2', () => {
    expect(COVERAGE_SUMMARY_SCHEMA_VERSION).toBe(2);
  });

  it('caps the whole summary at 2000 characters', () => {
    expect(COVERAGE_SUMMARY_MAX_TOTAL_LENGTH).toBe(2000);
  });

  describe('system prompt', () => {
    it('asks for what is insured, not only for figures', () => {
      expect(COVERAGE_SUMMARY_SYSTEM_PROMPT).toMatch(/versichert/i);
      expect(COVERAGE_SUMMARY_SYSTEM_PROMPT).toMatch(/Deckungssumme/);
    });

    it('states the total character budget', () => {
      expect(COVERAGE_SUMMARY_SYSTEM_PROMPT).toContain(
        String(COVERAGE_SUMMARY_MAX_TOTAL_LENGTH),
      );
    });

    it('keeps the prompt-injection containment', () => {
      expect(COVERAGE_SUMMARY_SYSTEM_PROMPT).toMatch(/DATEN/);
    });
  });

  describe('coverageSummaryContentLength', () => {
    it('counts titles, items, notes and hints', () => {
      const doc: CoverageSummaryDocument = {
        version: 2,
        sections: [{ title: 'Titel', items: ['Punkt'], note: 'Notiz' }],
        hints: ['Hinweis'],
      };
      expect(coverageSummaryContentLength(doc)).toBe('Titel'.length + 'Punkt'.length + 'Notiz'.length + 'Hinweis'.length);
    });
  });

  describe('validateCoverageSummary – total length', () => {
    it('accepts a version-2 summary within the budget', () => {
      const raw = JSON.stringify(documentWithContentLength(500));
      expect(validateCoverageSummary(raw).ok).toBe(true);
    });

    it('rejects a version-2 summary above the budget with a repairable error', () => {
      const raw = JSON.stringify(documentWithContentLength(3000));
      const result = validateCoverageSummary(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(String(COVERAGE_SUMMARY_MAX_TOTAL_LENGTH));
      }
    });

    it('keeps already stored version-1 summaries readable although they are longer', () => {
      // AP-24 rows written before the budget existed must not silently
      // degrade to the legacy rendering. Only the read path of stored rows
      // may opt out of the budget.
      const raw = JSON.stringify(documentWithContentLength(5000, 1));
      expect(validateCoverageSummary(raw, { allowLegacyTotalLength: true }).ok).toBe(true);
    });

    it('does not let a freshly generated answer dodge the budget via an old version number', () => {
      // Without the read-path option the budget always applies, so a model
      // cannot bypass it by labelling its answer "version 1".
      const raw = JSON.stringify(documentWithContentLength(5000, 1));
      expect(validateCoverageSummary(raw).ok).toBe(false);
    });

    it('counts hints towards the same budget', () => {
      const long = documentWithContentLength(1500);
      const doc: CoverageSummaryDocument = {
        ...long,
        // Three valid hints (each within the per-item limit) push the whole
        // summary over the budget while every single field stays legal.
        hints: ['y'.repeat(300), 'y'.repeat(300), 'y'.repeat(300)],
      };

      // The document alone is still within the budget ...
      expect(validateCoverageSummary(JSON.stringify(long)).ok).toBe(true);
      // ... and only the appended hints break it.
      expect(coverageSummaryContentLength(doc)).toBeGreaterThan(COVERAGE_SUMMARY_MAX_TOTAL_LENGTH);
      const result = validateCoverageSummary(JSON.stringify(doc));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(String(COVERAGE_SUMMARY_MAX_TOTAL_LENGTH));
      }
    });
  });

  describe('validateCoverageSummary – existing schema rules', () => {
    it('rejects an empty response', () => {
      expect(validateCoverageSummary('').ok).toBe(false);
    });

    it('rejects an answer without a JSON object', () => {
      expect(validateCoverageSummary('kein JSON').ok).toBe(false);
    });

    it('accepts a minimal valid document', () => {
      const raw = JSON.stringify({
        version: 2,
        sections: [{ title: 'Deckung', items: ['Deckungssumme 10.000.000 EUR'], note: null }],
        hints: [],
      });
      const result = validateCoverageSummary(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.version).toBe(2);
        expect(result.value.sections).toHaveLength(1);
      }
    });

    it('tolerates surrounding prose around the JSON object', () => {
      const raw =
        'Hier ist die Zusammenfassung:\n' +
        '{"version":2,"sections":[{"title":"Deckung","items":["x"],"note":null}],"hints":[]}\nDanke!';
      expect(validateCoverageSummary(raw).ok).toBe(true);
    });

    it('rejects a document without sections', () => {
      expect(parseCoverageSummary('{"version":2,"sections":[],"hints":[]}')).toBeNull();
    });

    it('exposes a repair hint free of document content', () => {
      const hint = buildCoverageSummaryRepairHint('at most 8 sections are allowed');
      expect(hint).toContain('at most 8 sections are allowed');
      expect(hint).toMatch(/JSON/);
    });
  });

  describe('coverageSummaryToPlainText', () => {
    it('renders sections, items, notes and hints', () => {
      const doc: CoverageSummaryDocument = {
        version: 2,
        sections: [
          { title: 'Versicherter Gegenstand', items: ['Hausrat'], note: 'inkl. Elektronik' },
        ],
        hints: ['Selbstbehalt fehlt'],
      };

      const text = coverageSummaryToPlainText(doc);
      expect(text).toContain('Versicherter Gegenstand');
      expect(text).toContain('- Hausrat');
      expect(text).toContain('inkl. Elektronik');
      expect(text).toContain('- Selbstbehalt fehlt');
    });
  });

  describe('round-trip', () => {
    it('parses and re-validates a realistic document', () => {
      const doc = documentWithContentLength(1200);
      const parsed = parseCoverageSummary(JSON.stringify(doc));
      expect(parsed).not.toBeNull();
      expect(validateCoverageSummary(JSON.stringify(parsed)).ok).toBe(true);
    });
  });
});
