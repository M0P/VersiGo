import { describe, expect, it } from 'vitest';
import {
  PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS,
  PAPERLESS_TAG_SYNC_MAX_INTERVAL_MS,
  PAPERLESS_TAG_SYNC_MIN_INTERVAL_MS,
  PAPERLESS_TAG_SYNC_STAGGER_MAX_MS,
  isPaperlessTagSyncDue,
  nextPaperlessTagSyncAt,
  paperlessTagSyncIntervalMs,
  paperlessTagSyncStaggerMs,
} from '../paperless-sync-schedule';
import { getSettingDefinition } from '../settings-catalog';
import { validateSettingValueByKey } from '../settings-validation';

const HOUR = 3_600_000;
const policyId = '33333333-3333-4333-3333-333333333333';

/**
 * AP-24 (§1.2): the scheduler (worker) and the status projection (API) share
 * these helpers, so their contract is the contract of the feature:
 * intervals are clamped, start times are staggered deterministically and a
 * disabled/never-synced state is never turned into a fabricated timestamp.
 */
describe('paperlessTagSyncIntervalMs', () => {
  it('returns the default for unusable values', () => {
    expect(paperlessTagSyncIntervalMs(undefined)).toBe(PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS);
    expect(paperlessTagSyncIntervalMs(null)).toBe(PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS);
    expect(paperlessTagSyncIntervalMs(Number.NaN)).toBe(PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS);
    expect(paperlessTagSyncIntervalMs(0)).toBe(PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS);
    expect(paperlessTagSyncIntervalMs(-1)).toBe(PAPERLESS_TAG_SYNC_DEFAULT_INTERVAL_MS);
  });

  it('clamps onto the validated catalog range', () => {
    expect(paperlessTagSyncIntervalMs(1)).toBe(PAPERLESS_TAG_SYNC_MIN_INTERVAL_MS);
    expect(paperlessTagSyncIntervalMs(HOUR * 48)).toBe(PAPERLESS_TAG_SYNC_MAX_INTERVAL_MS);
    expect(paperlessTagSyncIntervalMs(900_000)).toBe(900_000);
  });
});

describe('paperlessTagSyncStaggerMs', () => {
  it('is deterministic for a policy', () => {
    const first = paperlessTagSyncStaggerMs(policyId, 300_000);
    expect(paperlessTagSyncStaggerMs(policyId, 300_000)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(PAPERLESS_TAG_SYNC_STAGGER_MAX_MS);
  });

  it('stays inside the configured interval', () => {
    // A short interval must never be stretched beyond its own length.
    const window = paperlessTagSyncStaggerMs(policyId, PAPERLESS_TAG_SYNC_MIN_INTERVAL_MS);
    expect(window).toBeLessThanOrEqual(PAPERLESS_TAG_SYNC_MIN_INTERVAL_MS);
  });

  it('spreads different policies over the stagger window', () => {
    const spread = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      spread.add(paperlessTagSyncStaggerMs(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, HOUR));
    }
    expect(spread.size).toBeGreaterThan(10);
  });
});

describe('isPaperlessTagSyncDue', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  const interval = 300_000;
  const stagger = paperlessTagSyncStaggerMs(policyId, interval);

  it('is due immediately when the policy has never been synchronized', () => {
    expect(isPaperlessTagSyncDue({ policyId, lastSyncedAt: null, now, intervalMs: interval })).toBe(true);
    expect(isPaperlessTagSyncDue({ policyId, lastSyncedAt: undefined, now, intervalMs: interval })).toBe(true);
    // A broken timestamp must not silently block the sync forever.
    expect(isPaperlessTagSyncDue({ policyId, lastSyncedAt: 'nonsense', now, intervalMs: interval })).toBe(true);
  });

  it('waits for interval plus stagger', () => {
    const justBefore = new Date(now.getTime() - interval - stagger + 1);
    const justAfter = new Date(now.getTime() - interval - stagger - 1);

    expect(isPaperlessTagSyncDue({ policyId, lastSyncedAt: justBefore, now, intervalMs: interval })).toBe(false);
    expect(isPaperlessTagSyncDue({ policyId, lastSyncedAt: justAfter, now, intervalMs: interval })).toBe(true);
  });

  it('never runs faster than the configured interval', () => {
    expect(
      isPaperlessTagSyncDue({
        policyId,
        lastSyncedAt: new Date(now.getTime() - interval + 1),
        now,
        intervalMs: interval,
      }),
    ).toBe(false);
  });
});

describe('nextPaperlessTagSyncAt', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  const interval = 900_000;

  it('is never in the past', () => {
    // A long interval would otherwise announce a moment that already passed
    // (clock skew between "now" reads).
    const last = new Date(now.getTime() - 10 * HOUR);
    expect(nextPaperlessTagSyncAt({ policyId, lastSyncedAt: last, now, intervalMs: interval }).getTime()).toBe(
      now.getTime(),
    );
  });

  it('returns now for a policy that has never synchronized', () => {
    expect(nextPaperlessTagSyncAt({ policyId, lastSyncedAt: null, now, intervalMs: interval }).getTime()).toBe(
      now.getTime(),
    );
  });

  it('adds interval and stagger to the last run', () => {
    const last = new Date(now.getTime() - interval / 2);
    const next = nextPaperlessTagSyncAt({ policyId, lastSyncedAt: last, now, intervalMs: interval });
    expect(next.getTime()).toBe(
      last.getTime() + interval + paperlessTagSyncStaggerMs(policyId, interval),
    );
  });
});

describe('§1.2 settings', () => {
  it('offers the automatic sync switch with default "on" (existing behaviour)', () => {
    const definition = getSettingDefinition('PAPERLESS_TAG_SYNC_ENABLED');
    expect(definition).toBeDefined();
    expect(definition?.type).toBe('boolean');
    expect(definition?.category).toBe('runtime');
    expect(definition?.permission).toBe('ADMIN');
    expect(definition?.defaultValue).toBe(true);
  });

  it('offers predefined interval choices for the admin UI', () => {
    const definition = getSettingDefinition('PAPERLESS_TAG_SYNC_INTERVAL_MS');
    expect(definition?.presets).toEqual([300_000, 900_000, 1_800_000, 3_600_000, 21_600_000, 86_400_000]);
  });

  it('still accepts a validated free value that is not a preset', () => {
    // "Ein freier Wert ist nur zulässig, wenn er validiert wird" – a preset is
    // a convenience, not an allowlist.
    const free = validateSettingValueByKey('PAPERLESS_TAG_SYNC_INTERVAL_MS', '120000');
    expect(free.ok).toBe(true);
    expect(free.ok && free.value).toBe(120_000);
  });

  it('rejects values outside the bounds', () => {
    expect(validateSettingValueByKey('PAPERLESS_TAG_SYNC_INTERVAL_MS', '29999').ok).toBe(false);
    expect(validateSettingValueByKey('PAPERLESS_TAG_SYNC_INTERVAL_MS', '86400001').ok).toBe(false);
    expect(validateSettingValueByKey('PAPERLESS_TAG_SYNC_INTERVAL_MS', 'abc').ok).toBe(false);
    expect(validateSettingValueByKey('PAPERLESS_TAG_SYNC_ENABLED', 'maybe').ok).toBe(false);
    expect(validateSettingValueByKey('PAPERLESS_TAG_SYNC_ENABLED', 'false').ok).toBe(true);
  });
});
