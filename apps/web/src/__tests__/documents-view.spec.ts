import { describe, it, expect } from 'vitest';
import { createTranslator } from '../i18n/core';
import {
  DOCUMENT_ORIGIN_KINDS,
  DOCUMENT_SORT_KEYS,
  documentOriginIcon,
  documentOriginKind,
  documentOriginLabelKey,
  sortDocuments,
  type SortableDocument,
} from '../lib/documents-view';

const documents: SortableDocument[] = [
  { fileName: 'Zeugnis', documentDate: '2024-05-02T00:00:00.000Z' },
  { fileName: 'angebot', documentDate: '2025-01-15T00:00:00.000Z' },
  { fileName: 'Police', documentDate: null },
  { fileName: 'Beitrag', documentDate: '2023-11-30T00:00:00.000Z' },
];

const names = (docs: SortableDocument[]) => docs.map((d) => d.fileName);

describe('sortDocuments (BugFix-22: sort by date and alphabetically)', () => {
  it('offers exactly the four documented sort orders', () => {
    expect(DOCUMENT_SORT_KEYS).toEqual(['dateDesc', 'dateAsc', 'nameAsc', 'nameDesc']);
  });

  it('sorts by document date, newest first', () => {
    expect(names(sortDocuments(documents, 'dateDesc'))).toEqual([
      'angebot',
      'Zeugnis',
      'Beitrag',
      'Police',
    ]);
  });

  it('sorts by document date, oldest first, with undated documents last', () => {
    expect(names(sortDocuments(documents, 'dateAsc'))).toEqual([
      'Beitrag',
      'Zeugnis',
      'angebot',
      'Police',
    ]);
  });

  it('sorts by name in both directions, case-insensitively', () => {
    expect(names(sortDocuments(documents, 'nameAsc'))).toEqual([
      'angebot',
      'Beitrag',
      'Police',
      'Zeugnis',
    ]);
    expect(names(sortDocuments(documents, 'nameDesc'))).toEqual([
      'Zeugnis',
      'Police',
      'Beitrag',
      'angebot',
    ]);
  });

  it('does not mutate the input list (React state must stay untouched)', () => {
    const input = [...documents];
    sortDocuments(input, 'nameAsc');
    expect(names(input)).toEqual(names(documents));
  });

  it('keeps entries without a date in their original order (stable)', () => {
    const withoutDates: SortableDocument[] = [
      { fileName: 'c', documentDate: null },
      { fileName: 'b', documentDate: null },
      { fileName: 'a', documentDate: '2024-01-01T00:00:00.000Z' },
    ];
    expect(names(sortDocuments(withoutDates, 'dateDesc'))).toEqual(['a', 'c', 'b']);
  });
});

describe('document origin (BugFix-22: icon instead of text)', () => {
  it('derives the origin kind from both origin flags', () => {
    expect(documentOriginKind({ linkOriginTag: true })).toBe('auto');
    expect(documentOriginKind({ linkOriginManual: true })).toBe('manual');
    expect(documentOriginKind({ linkOriginTag: true, linkOriginManual: true })).toBe('both');
    expect(documentOriginKind({})).toBeNull();
    expect(documentOriginKind({ linkOriginTag: false, linkOriginManual: false })).toBeNull();
  });

  it('maps every kind to an icon name and a label key that resolves in both catalogs', () => {
    const tDe = createTranslator('de');
    const tEn = createTranslator('en');
    expect(DOCUMENT_ORIGIN_KINDS).toEqual(['auto', 'manual', 'both']);

    for (const kind of DOCUMENT_ORIGIN_KINDS) {
      expect(documentOriginIcon(kind).length).toBeGreaterThan(0);
      const key = documentOriginLabelKey(kind);
      expect(tDe(key)).not.toBe(key);
      expect(tEn(key)).not.toBe(key);
    }
  });
});
