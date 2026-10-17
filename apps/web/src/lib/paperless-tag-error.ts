/**
 * AP-22: maps the stable error codes of the interactive Paperless tag API
 * (tag search, tag creation and tag assignment) onto i18n keys.
 *
 * The API answers with a machine-readable prefix such as
 * `PAPERLESS_NOT_CONFIGURED: …`. Without this mapping the UI could only show
 * an empty result list ("no matching tag") or a generic error, hiding the
 * real cause: missing configuration, rejected credentials, an outage or a
 * request Paperless refused.
 */

/** i18n keys that explain a failed tag request. */
export type PaperlessTagErrorKey =
  | 'policies.paperlessTagErrorNOT_CONFIGURED'
  | 'policies.paperlessTagErrorAUTH_FAILED'
  | 'policies.paperlessTagErrorUNREACHABLE'
  | 'policies.paperlessTagErrorTAG_DELETED'
  | 'policies.paperlessTagErrorREJECTED';

const CODE_TO_KEY: ReadonlyArray<readonly [string, PaperlessTagErrorKey]> = [
  ['PAPERLESS_NOT_CONFIGURED', 'policies.paperlessTagErrorNOT_CONFIGURED'],
  ['PAPERLESS_AUTH_FAILED', 'policies.paperlessTagErrorAUTH_FAILED'],
  ['PAPERLESS_UNREACHABLE', 'policies.paperlessTagErrorUNREACHABLE'],
  ['PAPERLESS_TAG_SEARCH_FAILED', 'policies.paperlessTagErrorREJECTED'],
  ['PAPERLESS_TAG_CREATE_FAILED', 'policies.paperlessTagErrorREJECTED'],
  // `PUT …/paperless-tag` rejects a tag that no longer exists in Paperless.
  ['PAPERLESS_TAG_NOT_FOUND', 'policies.paperlessTagErrorTAG_DELETED'],
];

/**
 * `PUT …/paperless-tag` reports a tag lookup that failed for a reason without
 * its own code as `PAPERLESS_TAG_LOOKUP_FAILED: <KIND>`, where `<KIND>` is the
 * adapter reason (`AUTH_FAILED` | `UNREACHABLE`; the not-configured and
 * not-found cases have their own codes). The reason is resolved like a
 * standalone code, so the user still sees the concrete cause instead of a raw
 * technical string.
 */
const LOOKUP_FAILED_PREFIX = 'PAPERLESS_TAG_LOOKUP_FAILED: ';

/**
 * Every code this mapper understands. Exported so a test can pin the list
 * against the codes the API actually emits (guarding against drift between
 * the two packages).
 */
export const PAPERLESS_TAG_ERROR_CODES: readonly string[] = [
  ...CODE_TO_KEY.map(([code]) => code),
  'PAPERLESS_TAG_LOOKUP_FAILED',
];

/**
 * Reads the message text out of an API error body. Nest answers with
 * `{ message: string }`, with `{ message: string[] }` for DTO validation
 * errors, or the caller may already hold a raw message string.
 */
function messageText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is string => typeof entry === 'string').join(' ');
  }
  if (typeof payload === 'object' && payload !== null) {
    return messageText((payload as { message?: unknown }).message);
  }
  return '';
}

/**
 * Resolves the explanation for a failed tag request.
 *
 * @param payload parsed API error body, a raw message or null
 * @param fallbackKey i18n key used when no known error code is present
 */
export function paperlessTagErrorKey(payload: unknown, fallbackKey: string): string {
  const text = messageText(payload);

  const lookupAt = text.indexOf(LOOKUP_FAILED_PREFIX);
  if (lookupAt >= 0) {
    const kind = text.slice(lookupAt + LOOKUP_FAILED_PREFIX.length).split(/[^A-Z_]/)[0];
    const kindMatch = CODE_TO_KEY.find(([code]) => code === `PAPERLESS_${kind}`);
    if (kindMatch) return kindMatch[1];
  }

  const match = CODE_TO_KEY.find(([code]) => text.includes(code));
  return match ? match[1] : fallbackKey;
}
