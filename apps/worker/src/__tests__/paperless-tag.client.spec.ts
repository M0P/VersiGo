import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { SettingsResolverService } from '@versigo/foundation';
import {
  PaperlessTagClient,
  TAG_DOCUMENT_METADATA_FIELDS,
  TAG_DOCUMENT_MINIMAL_FIELDS,
  mapTagDocument,
  tagDocumentsPath,
} from '../paperless-tag.client';

/**
 * Regression tests for the round-5 code review finding.
 *
 * `PaperlessTagClient` is registered as a class provider in `WorkerModule`
 * while its constructor takes `SettingsResolverService`. Nest can only inject
 * that dependency when:
 *
 *  1. the class carries `@Injectable()` – TypeScript emits `design:paramtypes`
 *     *only* for decorated declarations, so without the decorator Nest falls
 *     back to `new PaperlessTagClient()` and `this.settings` is `undefined`
 *     (every tag job would then throw at runtime while the processor unit
 *     tests, which hand-build the client, still pass); and
 *  2. the dependency is imported as a *value* – a type-only import is erased at
 *     compile time, leaving the emitted metadata entry `undefined` even though
 *     the decorator is present.
 *
 * Note: vitest transpiles with esbuild, which does not implement
 * `emitDecoratorMetadata`, so `design:paramtypes` cannot be asserted here (it
 * is absent even for correct code). The production worker is compiled with
 * `tsc` (`emitDecoratorMetadata: true`), where the points above matter. These
 * tests therefore check the two prerequisites that *are* observable in this
 * environment: the decorator watermark and the runtime value import.
 */
describe('PaperlessTagClient (DI wiring)', () => {
  it('is decorated with @Injectable so Nest can resolve its constructor', () => {
    // `@Injectable()` calls `Reflect.defineMetadata('__injectable__', true, target)`.
    expect(Reflect.getMetadata('__injectable__', PaperlessTagClient)).toBe(true);
  });

  it('imports the settings resolver as a value (not a type-only import)', () => {
    expect(SettingsResolverService).toBeDefined();
    expect(typeof SettingsResolverService).toBe('function');
  });
});

/**
 * BugFix-21: the tag listing additionally requests the document date and the
 * MIME type so the sync can store the metadata the UI displays.
 */
describe('tag document listing metadata', () => {
  it('requests the metadata fields', () => {
    expect(TAG_DOCUMENT_METADATA_FIELDS).toBe('id,title,created,mime_type');
    expect(tagDocumentsPath(7, 2)).toContain(`fields=${TAG_DOCUMENT_METADATA_FIELDS}`);
    expect(tagDocumentsPath(7, 2)).toContain('tags__id=7');
    expect(tagDocumentsPath(7, 2)).toContain('page=2');
  });

  it('can be built with the minimal fallback field set', () => {
    expect(tagDocumentsPath(7, 1, TAG_DOCUMENT_MINIMAL_FIELDS)).toContain(
      `fields=${TAG_DOCUMENT_MINIMAL_FIELDS}`,
    );
  });

  it('maps a Paperless list entry to a tag document reference', () => {
    expect(
      mapTagDocument({
        id: 42,
        title: 'Police 2026',
        created: '2026-01-15',
        mime_type: 'application/pdf',
      }),
    ).toEqual({
      paperlessId: 42,
      title: 'Police 2026',
      createdAt: '2026-01-15',
      mimeType: 'application/pdf',
    });
  });

  it('reports missing or malformed metadata as null instead of guessing', () => {
    expect(mapTagDocument({ id: 42, title: 7, created: null, mime_type: 99 })).toEqual({
      paperlessId: 42,
      title: null,
      createdAt: null,
      mimeType: null,
    });
    expect(mapTagDocument({ id: 43 })).toEqual({
      paperlessId: 43,
      title: null,
      createdAt: null,
      mimeType: null,
    });
  });
});
