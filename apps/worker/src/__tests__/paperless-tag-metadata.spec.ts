import { describe, it, expect } from 'vitest';
import { deriveTagLinkMetadata, parsePaperlessDate } from '../paperless-tag.processor';
import type { TagDocumentRef } from '../paperless-tag.client';

const remote = (overrides: Partial<TagDocumentRef> = {}): TagDocumentRef => ({
  paperlessId: 42,
  title: 'Police 2026',
  createdAt: '2026-01-15T00:00:00Z',
  mimeType: 'application/pdf',
  ...overrides,
});

describe('parsePaperlessDate', () => {
  it('accepts the date formats Paperless returns', () => {
    expect(parsePaperlessDate('2026-01-15')?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(parsePaperlessDate('2026-01-15T10:30:00Z')?.toISOString()).toBe(
      '2026-01-15T10:30:00.000Z',
    );
  });

  it('rejects empty and unusable values instead of writing garbage', () => {
    expect(parsePaperlessDate(null)).toBeNull();
    expect(parsePaperlessDate(undefined)).toBeNull();
    expect(parsePaperlessDate('   ')).toBeNull();
    expect(parsePaperlessDate('not-a-date')).toBeNull();
  });
});

describe('deriveTagLinkMetadata', () => {
  it('derives all metadata for a new document', () => {
    expect(deriveTagLinkMetadata(remote(), null)).toEqual({
      fileName: 'Police 2026',
      documentDate: new Date('2026-01-15T00:00:00Z'),
      mimeType: 'application/pdf',
    });
  });

  it('trims the Paperless title and ignores an empty one', () => {
    expect(deriveTagLinkMetadata(remote({ title: '  Police 2026  ' }), null).fileName).toBe(
      'Police 2026',
    );
    expect(deriveTagLinkMetadata(remote({ title: '   ' }), null).fileName).toBeUndefined();
    expect(deriveTagLinkMetadata(remote({ title: null }), null).fileName).toBeUndefined();
  });

  it('refreshes metadata of an automatically managed document', () => {
    expect(
      deriveTagLinkMetadata(remote({ title: 'Neu', mimeType: 'image/png' }), {
        linkOriginManual: false,
        fileName: 'Alt',
        documentDate: new Date('2020-01-01T00:00:00Z'),
        mimeType: 'application/pdf',
      }),
    ).toEqual({
      fileName: 'Neu',
      documentDate: new Date('2026-01-15T00:00:00Z'),
      mimeType: 'image/png',
    });
  });

  it('writes nothing when nothing changed', () => {
    expect(
      deriveTagLinkMetadata(remote(), {
        linkOriginManual: false,
        fileName: 'Police 2026',
        documentDate: new Date('2026-01-15T00:00:00Z'),
        mimeType: 'application/pdf',
      }),
    ).toEqual({});
  });

  it('keeps user-edited values of a manual link', () => {
    expect(
      deriveTagLinkMetadata(remote(), {
        linkOriginManual: true,
        fileName: 'Mein Name',
        documentDate: new Date('2020-05-05T00:00:00Z'),
        mimeType: 'image/png',
      }),
    ).toEqual({});
  });

  it('fills only missing values of a manual link', () => {
    expect(
      deriveTagLinkMetadata(remote(), {
        linkOriginManual: true,
        fileName: 'Mein Name',
        documentDate: null,
        mimeType: null,
      }),
    ).toEqual({
      documentDate: new Date('2026-01-15T00:00:00Z'),
      mimeType: 'application/pdf',
    });
  });

  it('reports nothing for remote entries without metadata', () => {
    expect(
      deriveTagLinkMetadata(remote({ title: null, createdAt: null, mimeType: null }), null),
    ).toEqual({});
  });
});
