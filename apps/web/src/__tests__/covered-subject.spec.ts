import { describe, it, expect } from 'vitest';
import { createTranslator } from '../i18n/core';
import {
  COVERED_SUBJECT_TYPES,
  coveredSubjectIcon,
  coveredSubjectLabelKey,
  isBirthDateRelevant,
  normalizeCoveredSubjectType,
} from '../lib/covered-subject';

describe('covered subject kind (BugFix-22: persons or objects)', () => {
  it('supports exactly PERSON and OBJECT, defaulting to PERSON', () => {
    expect(COVERED_SUBJECT_TYPES).toEqual(['PERSON', 'OBJECT']);
    expect(normalizeCoveredSubjectType(undefined)).toBe('PERSON');
    expect(normalizeCoveredSubjectType(null)).toBe('PERSON');
    expect(normalizeCoveredSubjectType('')).toBe('PERSON');
    expect(normalizeCoveredSubjectType('PERSON')).toBe('PERSON');
    expect(normalizeCoveredSubjectType('OBJECT')).toBe('OBJECT');
    // Unknown values must never leak into the UI as-is.
    expect(normalizeCoveredSubjectType('SOMETHING_ELSE')).toBe('PERSON');
  });

  it('maps every kind to an icon and a label that resolves in both catalogs', () => {
    const tDe = createTranslator('de');
    const tEn = createTranslator('en');

    for (const type of COVERED_SUBJECT_TYPES) {
      expect(coveredSubjectIcon(type).length).toBeGreaterThan(0);
      const key = coveredSubjectLabelKey(type);
      expect(tDe(key)).not.toBe(key);
      expect(tEn(key)).not.toBe(key);
    }
  });

  it('offers a birth date only for persons', () => {
    expect(isBirthDateRelevant('PERSON')).toBe(true);
    expect(isBirthDateRelevant('OBJECT')).toBe(false);
  });
});
