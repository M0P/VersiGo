import { describe, it, expect } from 'vitest';
import { createTranslator } from '../i18n/core';
import {
  COVERED_SUBJECT_TYPES,
  coveredSubjectIcon,
  coveredSubjectLabelKey,
  coveredSubjectNameLabelKey,
  coveredSubjectNamePlaceholderKey,
  coveredSubjectRelationLabelKey,
  coveredSubjectRelationPlaceholderKey,
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

// AP-24 (§5): the wording of the name and relation fields follows the
// selected subject type instead of the static "Personenname".
describe('covered subject labels (AP-24 §5)', () => {
  const tDe = createTranslator('de');
  const tEn = createTranslator('en');

  it('resolves a distinct name label and placeholder for every kind in both catalogs', () => {
    for (const type of COVERED_SUBJECT_TYPES) {
      const labelKey = coveredSubjectNameLabelKey(type);
      const placeholderKey = coveredSubjectNamePlaceholderKey(type);

      expect(tDe(labelKey)).not.toBe(labelKey);
      expect(tEn(labelKey)).not.toBe(labelKey);
      expect(tDe(placeholderKey)).not.toBe(placeholderKey);
      expect(tEn(placeholderKey)).not.toBe(placeholderKey);
    }
  });

  it('uses object wording for OBJECT and person wording for PERSON', () => {
    expect(tDe(coveredSubjectNameLabelKey('OBJECT'))).toBe('Bezeichnung des Objekts');
    expect(tDe(coveredSubjectNameLabelKey('PERSON'))).toBe('Personenname');
    expect(tEn(coveredSubjectNameLabelKey('OBJECT'))).toBe('Object name');
  });

  it('drops the "(Optional)" suffix from the relation label', () => {
    for (const type of COVERED_SUBJECT_TYPES) {
      const label = tDe(coveredSubjectRelationLabelKey(type));
      expect(label).not.toBe('');
      expect(label.toLowerCase()).not.toContain('optional');
    }
  });

  it('names the relation field differently for objects than for persons', () => {
    expect(tDe(coveredSubjectRelationLabelKey('PERSON'))).toBe('Beziehung');
    // "Beziehung" would be misleading for an insured car or house.
    expect(tDe(coveredSubjectRelationLabelKey('OBJECT'))).not.toBe('Beziehung');
    expect(tEn(coveredSubjectRelationLabelKey('OBJECT'))).not.toBe('Relation');
  });

  it('keeps every relation placeholder resolvable in both catalogs', () => {
    for (const type of COVERED_SUBJECT_TYPES) {
      const key = coveredSubjectRelationPlaceholderKey(type);
      expect(tDe(key)).not.toBe(key);
      expect(tEn(key)).not.toBe(key);
    }
  });
});
