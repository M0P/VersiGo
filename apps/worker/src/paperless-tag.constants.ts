/**
 * AP-22: queue/job constants for the worker.
 *
 * IMPORTANT: the queue name and job names MUST match
 * `apps/api/src/features/paperless-ngx/paperless-tag.constants.ts`. The two
 * apps are separate Nest applications without a shared runtime package for
 * this feature (the same pattern as the `ai-extraction` queue name), so the
 * values are intentionally duplicated and must be kept in sync.
 */
export const PAPERLESS_TAG_QUEUE = 'paperless-tag-sync';

export const PAPERLESS_TAG_SYNC_POLICY_JOB = 'sync-policy';
export const PAPERLESS_TAG_TAG_DOCUMENT_JOB = 'tag-document';
export const PAPERLESS_TAG_RECONCILE_JOB = 'reconcile';

/**
 * Fixed cadence of the reconciliation tick and its stable BullMQ job id.
 * MUST match `apps/api/src/features/paperless-ngx/paperless-tag.constants.ts`:
 * both apps register the same repeatable job, so the id/options must be
 * identical or two ticks would be scheduled.
 */
export const PAPERLESS_TAG_RECONCILE_TICK_MS = 60_000;
export const PAPERLESS_TAG_RECONCILE_JOB_ID = 'paperless-tag-reconcile';

/** Default sync interval in milliseconds (5 minutes). */
export const PAPERLESS_TAG_DEFAULT_INTERVAL_MS = 300_000;

/** Max documents fetched per tag sync page (Paperless hard cap). */
export const PAPERLESS_TAG_PAGE_SIZE = 100;

/** Upper bound of pages walked per sync (defense against runaway APIs). */
export const PAPERLESS_TAG_MAX_PAGES = 50;
