import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { PAPERLESS_TAG_ERROR_CODES, paperlessTagErrorKey } from '../lib/paperless-tag-error';

/**
 * AP-22 follow-up: the interactive Paperless tag API answers with a stable
 * error code instead of a silent empty result, so the UI can name the cause.
 */
describe('paperlessTagErrorKey', () => {
  it('maps a missing configuration to the not-configured hint', () => {
    expect(
      paperlessTagErrorKey(
        { message: 'PAPERLESS_NOT_CONFIGURED: Paperless-ngx is not configured' },
        'fallback',
      ),
    ).toBe('policies.paperlessTagErrorNOT_CONFIGURED');
  });

  it('maps rejected credentials to the permissions hint', () => {
    expect(
      paperlessTagErrorKey(
        { message: 'PAPERLESS_AUTH_FAILED: Paperless-ngx rejected the API token' },
        'fallback',
      ),
    ).toBe('policies.paperlessTagErrorAUTH_FAILED');
  });

  it('maps an outage to the availability hint', () => {
    expect(
      paperlessTagErrorKey(
        { message: 'PAPERLESS_UNREACHABLE: Paperless-ngx is not reachable' },
        'fallback',
      ),
    ).toBe('policies.paperlessTagErrorUNREACHABLE');
  });

  it('maps a refused search or creation to the rejected hint', () => {
    expect(
      paperlessTagErrorKey(
        { message: 'PAPERLESS_TAG_SEARCH_FAILED: Paperless-ngx rejected the tag search' },
        'fallback',
      ),
    ).toBe('policies.paperlessTagErrorREJECTED');
    expect(
      paperlessTagErrorKey(
        { message: 'PAPERLESS_TAG_CREATE_FAILED: the tag could not be created in Paperless' },
        'fallback',
      ),
    ).toBe('policies.paperlessTagErrorREJECTED');
  });

  it('maps the tag assignment codes instead of showing them raw', () => {
    // A tag that vanished between selection and assignment.
    expect(
      paperlessTagErrorKey({ message: 'PAPERLESS_TAG_NOT_FOUND: unknown tag' }, 'fallback'),
    ).toBe('policies.paperlessTagErrorTAG_DELETED');

    // `PUT …/paperless-tag` embeds the adapter reason in the message.
    expect(
      paperlessTagErrorKey({ message: 'PAPERLESS_TAG_LOOKUP_FAILED: AUTH_FAILED' }, 'fallback'),
    ).toBe('policies.paperlessTagErrorAUTH_FAILED');
    expect(
      paperlessTagErrorKey(
        { message: 'PAPERLESS_TAG_LOOKUP_FAILED: NOT_CONFIGURED' },
        'fallback',
      ),
    ).toBe('policies.paperlessTagErrorNOT_CONFIGURED');
    expect(
      paperlessTagErrorKey({ message: 'PAPERLESS_TAG_LOOKUP_FAILED: UNREACHABLE' }, 'fallback'),
    ).toBe('policies.paperlessTagErrorUNREACHABLE');

    // An unknown embedded reason falls back to the generic message.
    expect(
      paperlessTagErrorKey({ message: 'PAPERLESS_TAG_LOOKUP_FAILED: SURPRISE' }, 'fallback'),
    ).toBe('fallback');
  });

  it('accepts a raw message string and a validation array', () => {
    expect(paperlessTagErrorKey('PAPERLESS_UNREACHABLE: x', 'fallback')).toBe(
      'policies.paperlessTagErrorUNREACHABLE',
    );
    expect(paperlessTagErrorKey({ message: ['name must be a string'] }, 'fallback')).toBe(
      'fallback',
    );
  });

  it('falls back for unknown or missing payloads', () => {
    expect(paperlessTagErrorKey(null, 'policies.paperlessTagSearchError')).toBe(
      'policies.paperlessTagSearchError',
    );
    expect(paperlessTagErrorKey(undefined, 'fallback')).toBe('fallback');
    expect(paperlessTagErrorKey({ message: 'Unauthorized' }, 'fallback')).toBe('fallback');
    expect(paperlessTagErrorKey({}, 'fallback')).toBe('fallback');
  });

  it('stays in sync with the codes emitted by the API', () => {
    // The API emits the codes as string literals in
    // apps/api/src/features/paperless-ngx/paperless-tag.service.ts (quoted or
    // as a template literal). Pinning the list here makes a rename on either
    // side fail loudly instead of letting the UI silently degrade to a
    // generic message - the exact symptom class this mapping exists to
    // prevent.
    const apiSource = readApiServiceSource();
    const emitted = Array.from(
      new Set(
        Array.from(apiSource.matchAll(/['`](PAPERLESS_[A-Z_]+):/g), (match) => match[1]),
      ),
    ).sort();

    expect(emitted).toEqual(Array.from(PAPERLESS_TAG_ERROR_CODES).sort());

    // Every emitted code needs a dedicated explanation, not the fallback.
    for (const code of emitted) {
      const reason = code === 'PAPERLESS_TAG_LOOKUP_FAILED' ? 'UNREACHABLE' : 'boom';
      expect(
        paperlessTagErrorKey(`${code}: ${reason}`, 'fallback'),
        `no explanation for ${code}`,
      ).not.toBe('fallback');
    }
  });
});

/**
 * Reads the API service that emits the error codes. The guard only works
 * inside the monorepo checkout, so an unreadable file fails with an explicit
 * message instead of silently skipping the check.
 */
function readApiServiceSource(): string {
  const path = new URL(
    '../../../../apps/api/src/features/paperless-ngx/paperless-tag.service.ts',
    import.meta.url,
  );
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `Unable to read ${path.pathname}. The error-code guard requires the monorepo checkout.`,
    );
  }
}
