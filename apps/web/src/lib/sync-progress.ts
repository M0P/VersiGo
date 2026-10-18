/**
 * AP-24 (§1.1): presentation logic of the Paperless synchronization progress.
 *
 * Kept outside the component so the two hard requirements are testable as
 * plain behaviour:
 *
 * 1. Never invent a percentage. A determinate bar (and therefore a
 *    `aria-valuenow`) is only allowed when the total is actually known.
 * 2. Without a total the bar stays indeterminate and the accessible value is
 *    the already processed intermediate count instead of a fake ratio.
 */

export type SyncProgressShape = {
  processed: number;
  /** `null` while the total is unknown. */
  total: number | null;
};

export type SyncProgressAria = {
  /** `true` → determinate fill, `false` → indeterminate animation. */
  determinate: boolean;
  ariaValuemax: number | undefined;
  ariaValuenow: number | undefined;
  /** Always set: the one value a screen reader announces for the bar. */
  ariaValuetext: 'ratio' | 'intermediate';
  /** Percentage width of the determinate fill (0–100). */
  percent: number;
};

/**
 * Derives the accessible representation of the progress bar.
 *
 * `total` must be a positive number to count as known: a total of 0 would
 * produce a division by zero and a "100%" claim for a run that has not
 * processed anything yet.
 */
export function syncProgressAria(progress: SyncProgressShape): SyncProgressAria {
  const totalKnown = progress.total !== null && progress.total > 0;
  const total = progress.total ?? 0;
  const processed = Math.max(0, progress.processed);
  const bounded = totalKnown ? Math.min(processed, total) : 0;

  return {
    determinate: totalKnown,
    ariaValuemax: totalKnown ? total : undefined,
    ariaValuenow: totalKnown ? bounded : undefined,
    ariaValuetext: totalKnown ? 'ratio' : 'intermediate',
    percent: totalKnown ? Math.round((bounded / total) * 100) : 0,
  };
}

export type SyncJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/** `true` while a run is queued or running – the trigger must stay disabled. */
export function isSyncActive(status: SyncJobStatus | null | undefined): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}
