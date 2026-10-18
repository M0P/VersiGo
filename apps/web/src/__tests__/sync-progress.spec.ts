import { describe, it, expect } from 'vitest';
import {
  isSyncActive,
  syncProgressAria,
  type SyncJobStatus,
} from '../lib/sync-progress';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTranslator } from '../i18n/core';

/**
 * AP-24 (§1.1) regression guard: the status section must never show a
 * percentage that the server did not actually provide, and every statically
 * used translation key must exist in both catalogs (a missing key would be
 * rendered literally by the translator's fallback).
 */

describe('syncProgressAria', () => {
  it('stays indeterminate while the total is unknown', () => {
    const aria = syncProgressAria({ processed: 12, total: null });

    expect(aria.determinate).toBe(false);
    // No aria-valuenow → a screen reader announces "busy", not a ratio.
    expect(aria.ariaValuenow).toBeUndefined();
    expect(aria.ariaValuemax).toBeUndefined();
    expect(aria.ariaValuetext).toBe('intermediate');
    expect(aria.percent).toBe(0);
  });

  it('reports a bounded ratio when the total is known', () => {
    const aria = syncProgressAria({ processed: 40, total: 100 });

    expect(aria.determinate).toBe(true);
    expect(aria.ariaValuenow).toBe(40);
    expect(aria.ariaValuemax).toBe(100);
    expect(aria.ariaValuetext).toBe('ratio');
    expect(aria.percent).toBe(40);
  });

  it('clamps a processed count above the total instead of exceeding 100%', () => {
    const aria = syncProgressAria({ processed: 130, total: 100 });

    expect(aria.ariaValuenow).toBe(100);
    expect(aria.percent).toBe(100);
  });

  it('treats a total of 0 as unknown rather than dividing by zero', () => {
    const aria = syncProgressAria({ processed: 0, total: 0 });

    expect(aria.determinate).toBe(false);
    expect(aria.ariaValuenow).toBeUndefined();
    expect(aria.percent).toBe(0);
  });

  it('never yields a negative or non-finite value', () => {
    expect(syncProgressAria({ processed: -5, total: 10 }).percent).toBe(0);
    expect(syncProgressAria({ processed: -5, total: null }).ariaValuetext).toBe('intermediate');
  });
});

describe('isSyncActive', () => {
  it('disables the trigger only for queued or running runs', () => {
    expect(isSyncActive('QUEUED')).toBe(true);
    expect(isSyncActive('RUNNING')).toBe(true);
    expect(isSyncActive('SUCCEEDED')).toBe(false);
    expect(isSyncActive('FAILED')).toBe(false);
    expect(isSyncActive(null)).toBe(false);
    expect(isSyncActive(undefined)).toBe(false);
  });

  it('covers every public status value', () => {
    const all: SyncJobStatus[] = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'];
    expect(all.filter((s) => isSyncActive(s))).toEqual(['QUEUED', 'RUNNING']);
  });
});

// --- translation key guard ------------------------------------------------

const COMPONENT_PATH = fileURLToPath(
  new URL('../app/policies/[id]/paperless-tag-section.tsx', import.meta.url),
);

function collectStaticKeys(source: string): string[] {
  const keys = new Set<string>();
  // Direct `t('…')` calls …
  const callPattern = /t\(\s*['"]([A-Za-z0-9_.]+)['"]/g;
  // … plus keys handed back by helpers such as `progressStatusKey()`, which the
  // component feeds into `t()` dynamically and a plain call scan would miss.
  const returnPattern = /return\s+['"]([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(source)) !== null) keys.add(match[1]);
  while ((match = returnPattern.exec(source)) !== null) keys.add(match[1]);
  return [...keys];
}

describe('paperless tag section translation keys', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');
  const keys = collectStaticKeys(source);
  const tDe = createTranslator('de');
  const tEn = createTranslator('en');

  it('finds the static keys of the component', () => {
    expect(keys.length).toBeGreaterThan(15);
  });

  it.each(keys)('resolves %s in German and English', (key) => {
    expect(tDe(key)).not.toBe(key);
    expect(tEn(key)).not.toBe(key);
  });

  it('announces every sync state', () => {
    // The status text sits in an aria-live region, so all four states need a
    // message or the region would stay silent.
    for (const state of ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']) {
      expect(keys).toContain(`policies.paperlessTagProgress${state}`);
    }
  });
});
