/**
 * AP-24 (§1.2): scheduling rules of the periodic Paperless-ngx tag sync.
 *
 * The worker decides *when* a policy is due for its background
 * reconciliation, while the API projects the same moment to the UI as
 * "next scheduled sync". Both apps import these helpers so the interface can
 * never promise a time the scheduler does not keep. The helpers are pure and
 * deterministic (no clock, no I/O) so both sides can be tested directly.
 */

/** Smallest accepted sync interval (30 s) – mirrors the settings catalog. */
export const PAPERLESS_TAG_SYNC_MIN_INTERVAL_MS = 30_000;

/** Largest accepted sync interval (24 h) – mirrors the settings catalog. */
export const PAPERLESS_TAG_SYNC_MAX_INTERVAL_MS = 86_400_000;

/** Default sync interval (5 minutes) when no setting is present. */
export const PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS = 300_000;

/**
 * Upper bound of the deterministic start spread (2 reconciliation ticks).
 *
 * Several insurances that were synced in the same minute would otherwise
 * become due in the same tick and be dispatched at the same instant. Each
 * policy gets a fixed offset of up to this value, so the run starts are
 * distributed over time while every individual interval stays >= the
 * configured minimum (the offset is added, never subtracted).
 */
export const PAPERLESS_TAG_SYNC_STAGGER_MAX_MS = 120_000;

/**
 * Clamps a raw interval onto the validated catalog range.
 *
 * Anything unusable (missing, NaN, non-positive) falls back to the default
 * so a broken setting can never stop the reconciliation entirely.
 */
export function paperlessTagSyncIntervalMs(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS;
  }
  return Math.min(
    Math.max(raw, PAPERLESS_TAG_SYNC_MIN_INTERVAL_MS),
    PAPERLESS_TAG_SYNC_MAX_INTERVAL_MS,
  );
}

/** Deterministic 32-bit FNV-1a hash – stable across processes and restarts. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Fixed per-policy offset inside `[0, min(interval, STAGGER_MAX)]`.
 *
 * Purely a function of the policy id, so the API and the worker always agree
 * on the same offset without exchanging state.
 */
export function paperlessTagSyncStaggerMs(
  policyId: string,
  intervalMs: number = PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS,
): number {
  const window = Math.min(
    Math.max(0, paperlessTagSyncIntervalMs(intervalMs)),
    PAPERLESS_TAG_SYNC_STAGGER_MAX_MS,
  );
  if (window === 0) return 0;
  return fnv1a(policyId) % (window + 1);
}

export type PaperlessTagDueInput = {
  policyId: string;
  /** `null`/`undefined` = never synchronized → due immediately. */
  lastSyncedAt: Date | string | null | undefined;
  now: Date;
  intervalMs: number;
};

/**
 * `true` when the periodic reconciliation may (re)start this policy.
 *
 * A policy that has never been synchronized is due right away (the admin
 * expects the first run after configuring a tag). Afterwards the configured
 * interval *plus* the policy's stagger offset must have elapsed.
 */
export function isPaperlessTagSyncDue(input: PaperlessTagDueInput): boolean {
  if (input.lastSyncedAt === null || input.lastSyncedAt === undefined) return true;
  const last = new Date(input.lastSyncedAt);
  if (Number.isNaN(last.getTime())) return true;

  const interval = paperlessTagSyncIntervalMs(input.intervalMs);
  const due = last.getTime() + interval + paperlessTagSyncStaggerMs(input.policyId, interval);
  return input.now.getTime() >= due;
}

export type PaperlessTagNextSyncInput = PaperlessTagDueInput;

/**
 * Earliest moment the next background sync of this policy may start.
 *
 * `lastSyncedAt === null` yields `now`: the sync is already due and only
 * waits for the next reconciliation tick. Callers that want to communicate
 * that delay add one tick themselves (the tick cadence is an app constant
 * the foundation deliberately does not know about).
 */
export function nextPaperlessTagSyncAt(input: PaperlessTagNextSyncInput): Date {
  if (input.lastSyncedAt === null || input.lastSyncedAt === undefined) return new Date(input.now);
  const last = new Date(input.lastSyncedAt);
  if (Number.isNaN(last.getTime())) return new Date(input.now);

  const interval = paperlessTagSyncIntervalMs(input.intervalMs);
  const next = last.getTime() + interval + paperlessTagSyncStaggerMs(input.policyId, interval);
  return new Date(Math.max(next, input.now.getTime()));
}
