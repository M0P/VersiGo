import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTranslator } from '../i18n/core';
import {
  ALL_DOCUMENT_CLASSES,
  BILLING_CLASS,
  CONTRACT_CLASS,
  DEFAULT_DOCUMENT_CLASS,
  DOCUMENT_CLASSES,
  DOCUMENT_CLASS_FILTERS,
  documentClassBadgeClass,
  documentClassFilterLabelKey,
  documentClassFilterValue,
  documentClassLabelKey,
  normalizeDocumentClass,
  pruneSelection,
  toggleSelected,
} from '../lib/document-class';

/** Reads a repository file relative to this spec (no DOM harness available). */
function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

// AP-24 (§2): Dokumentklassifikation.
describe('document class (AP-24 §2)', () => {
  const tDe = createTranslator('de');
  const tEn = createTranslator('en');

  it('offers the documented classes with UNCLASSIFIED as default', () => {
    expect(DOCUMENT_CLASSES).toEqual([
      'UNCLASSIFIED',
      'CONTRACT',
      'BILLING',
      'CORRESPONDENCE',
      'CLAIM',
      'OTHER',
    ]);
    expect(DEFAULT_DOCUMENT_CLASS).toBe('UNCLASSIFIED');
    // The two binding classes from the work package must exist.
    expect(CONTRACT_CLASS).toBe('CONTRACT');
    expect(BILLING_CLASS).toBe('BILLING');
  });

  it('falls back to UNCLASSIFIED for unknown or empty values', () => {
    expect(normalizeDocumentClass(undefined)).toBe('UNCLASSIFIED');
    expect(normalizeDocumentClass(null)).toBe('UNCLASSIFIED');
    expect(normalizeDocumentClass('')).toBe('UNCLASSIFIED');
    expect(normalizeDocumentClass('SOMETHING_ELSE')).toBe('UNCLASSIFIED');
    expect(normalizeDocumentClass('BILLING')).toBe('BILLING');
  });

  it('resolves a label for every class in both catalogs', () => {
    for (const value of DOCUMENT_CLASSES) {
      const key = documentClassLabelKey(value);
      expect(tDe(key)).not.toBe(key);
      expect(tEn(key)).not.toBe(key);
    }
  });

  it('uses the binding wording for CONTRACT and BILLING', () => {
    expect(tDe(documentClassLabelKey('BILLING'))).toBe('Abrechnung');
    expect(tDe(documentClassLabelKey('CONTRACT'))).toBe('Vertragsdokument');
  });

  it('renders the class as a badge built from existing variants only', () => {
    // The stylesheet defines exactly these variants – an unknown one would
    // render as plain, unstyled text.
    const css = read('../styles/globals.css');

    for (const value of DOCUMENT_CLASSES) {
      const className = documentClassBadgeClass(value);
      expect(className.startsWith('badge ')).toBe(true);
      const variant = className.slice('badge '.length);
      expect(css).toContain(`.${variant} {`);
    }

    // The default must not look like an active designation.
    expect(documentClassBadgeClass('UNCLASSIFIED')).toBe('badge badge-neutral');
    // The two actionable classes stay visually distinct.
    expect(documentClassBadgeClass('CONTRACT')).not.toBe(documentClassBadgeClass('BILLING'));
  });

  it('offers "ALL" as an additional filter value that maps to no parameter', () => {
    expect(DOCUMENT_CLASS_FILTERS[0]).toBe(ALL_DOCUMENT_CLASSES);
    expect(documentClassFilterValue(ALL_DOCUMENT_CLASSES)).toBeNull();
    expect(documentClassFilterValue('BILLING')).toBe('BILLING');
    expect(tDe(documentClassFilterLabelKey(ALL_DOCUMENT_CLASSES))).not.toBe(
      documentClassFilterLabelKey(ALL_DOCUMENT_CLASSES),
    );
  });
});

// AP-24 (§2.3): Mehrfachauswahl.
describe('bulk selection helpers (AP-24 §2.3)', () => {
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('adds and removes an entry without mutating the previous array', () => {
    const first = toggleSelected([], a);
    expect(first).toEqual([a]);

    const second = toggleSelected(first, b);
    expect(second).toEqual([a, b]);
    // The input array must stay untouched (React state).
    expect(first).toEqual([a]);

    expect(toggleSelected(second, a)).toEqual([b]);
  });

  it('drops IDs that are no longer part of the list', () => {
    const selection = toggleSelected(toggleSelected([], a), b);
    const pruned = pruneSelection(selection, [{ id: b }]);
    expect(pruned).toEqual([b]);
    expect(pruneSelection(selection, [])).toEqual([]);
  });
});
