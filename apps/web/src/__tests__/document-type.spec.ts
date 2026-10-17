import { describe, it, expect } from 'vitest';
import { createTranslator } from '../i18n/core';
import {
  documentTypeKind,
  documentTypeIcon,
  documentTypeLabelKey,
  type DocumentTypeKind,
} from '../lib/document-type';

const KINDS: DocumentTypeKind[] = ['pdf', 'image', 'document', 'spreadsheet', 'other'];

describe('documentTypeKind', () => {
  it('recognizes a PDF by MIME type and by extension', () => {
    expect(documentTypeKind('application/pdf', 'schein.pdf')).toBe('pdf');
    // Paperless reports generic MIME types for some uploads.
    expect(documentTypeKind('application/octet-stream', 'schein.PDF')).toBe('pdf');
  });

  it('recognizes images case-insensitively', () => {
    expect(documentTypeKind('image/JPEG', 'scan.jpg')).toBe('image');
    expect(documentTypeKind(null, 'scan.PNG')).toBe('image');
  });

  it('recognizes word processing documents', () => {
    expect(documentTypeKind('application/msword', 'brief.doc')).toBe('document');
    expect(
      documentTypeKind(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'brief.docx',
      ),
    ).toBe('document');
    expect(documentTypeKind('text/plain', 'notiz.txt')).toBe('document');
  });

  it('recognizes spreadsheets', () => {
    expect(documentTypeKind('text/csv', 'kosten.csv')).toBe('spreadsheet');
    expect(documentTypeKind('application/vnd.ms-excel', 'kosten.xls')).toBe('spreadsheet');
    // MIME type unknown, extension decisive.
    expect(documentTypeKind('application/octet-stream', 'kosten.xlsx')).toBe('spreadsheet');
  });

  it('falls back to other for unknown or missing type information', () => {
    expect(documentTypeKind(null, null)).toBe('other');
    expect(documentTypeKind(undefined, undefined)).toBe('other');
    expect(documentTypeKind('', 'datei')).toBe('other');
    expect(documentTypeKind('video/mp4', 'clip.mp4')).toBe('other');
  });

  it('ignores a bare dot without an extension', () => {
    expect(documentTypeKind('application/octet-stream', 'datei.')).toBe('other');
  });
});

describe('documentTypeIcon / documentTypeLabelKey', () => {
  it('maps every kind to an icon', () => {
    for (const kind of KINDS) {
      expect(documentTypeIcon(kind)).toMatch(/^file/);
    }
  });

  it('uses distinct icons per kind', () => {
    const icons = KINDS.map(documentTypeIcon);
    expect(new Set(icons).size).toBe(KINDS.length);
  });

  it('maps every kind to a catalog key', () => {
    for (const kind of KINDS) {
      expect(documentTypeLabelKey(kind)).toMatch(/^policies\.documentTypeKind/);
    }
  });

  // BugFix-21 (review #1): the icon label is passed to `t()` dynamically, so
  // the static-key guard cannot see it. A missing key would render the raw key
  // path as the accessible name – exactly the defect this package fixes.
  it('resolves every label key in both catalogs', () => {
    const tDe = createTranslator('de');
    const tEn = createTranslator('en');

    for (const kind of KINDS) {
      const key = documentTypeLabelKey(kind);
      expect(tDe(key)).not.toBe(key);
      expect(tEn(key)).not.toBe(key);
    }
  });
});
