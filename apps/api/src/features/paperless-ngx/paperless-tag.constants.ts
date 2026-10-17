/**
 * AP-22: BullMQ queue for Paperless-ngx tag-based document assignment.
 *
 * The queue name is shared between the API feature (job creation) and the
 * worker processor (job processing) and MUST stay identical in both apps.
 */
export const PAPERLESS_TAG_QUEUE = 'paperless-tag-sync';

/** Job: full tag-based reconciliation for a single policy. */
export const PAPERLESS_TAG_SYNC_POLICY_JOB = 'sync-policy';

/** Job: additively assign the policy tag to one manually linked document. */
export const PAPERLESS_TAG_TAG_DOCUMENT_JOB = 'tag-document';

/**
 * Job: periodic reconciliation tick (repeatable). Re-dispatches durable
 * outbox rows and schedules policy syncs that are due. The concrete
 * "due" interval is read from the PAPERLESS_TAG_SYNC_INTERVAL_MS setting
 * on every tick, so a configuration change takes effect without a restart.
 */
export const PAPERLESS_TAG_RECONCILE_JOB = 'reconcile';

/**
 * Fixed cadence of the reconciliation tick. This is intentionally NOT a
 * user-facing setting: it only controls how often the worker checks which
 * policies are due. The user-facing sync interval is
 * PAPERLESS_TAG_SYNC_INTERVAL_MS (default 5 minutes).
 */
export const PAPERLESS_TAG_RECONCILE_TICK_MS = 60_000;

/** Stable BullMQ job id of the repeatable reconciliation tick. */
export const PAPERLESS_TAG_RECONCILE_JOB_ID = 'paperless-tag-reconcile';

/** Max documents fetched per tag sync page (Paperless hard cap). */
export const PAPERLESS_TAG_PAGE_SIZE = 100;

/** Default sync interval in milliseconds (5 minutes). */
export const PAPERLESS_TAG_DEFAULT_INTERVAL_MS = 300_000;
