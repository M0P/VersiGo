import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTranslator } from '../i18n/core';

/**
 * BugFix-21 regression guard: `documents-tab.tsx` used `t('common.uploadedAt')`
 * although that key does not exist in the catalogs. `createTranslator` falls
 * back to the key path itself, so the UI literally showed `common.uploadedAt`.
 *
 * The type system cannot catch this (the translator accepts any string for
 * legacy reasons), so this test reads the component and asserts that every
 * statically used `t('…')` key resolves in BOTH catalogs.
 */
const COMPONENT_PATH = fileURLToPath(
  new URL('../app/policies/[id]/documents-tab.tsx', import.meta.url),
);

/** Static `t('key')` literals of the component (dynamic keys are skipped). */
function collectStaticKeys(source: string): string[] {
  const keys = new Set<string>();
  // BugFix-21 (review #2): both quote styles – `t("key")` would otherwise be
  // silently skipped and could reintroduce the rendered-key defect.
  const pattern = /t\(\s*['"]([A-Za-z0-9_.]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    keys.add(match[1]);
  }
  return [...keys];
}

describe('documents tab translation keys', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');
  const keys = collectStaticKeys(source);
  const tDe = createTranslator('de');
  const tEn = createTranslator('en');

  it('finds the static keys of the component', () => {
    // Guards the guard: a broken pattern must not silently pass.
    expect(keys.length).toBeGreaterThan(5);
  });

  it.each(keys)('resolves %s in German and English', (key) => {
    expect(tDe(key)).not.toBe(key);
    expect(tEn(key)).not.toBe(key);
  });

  it('no longer renders the uploadedAt timestamp', () => {
    expect(source).not.toContain('common.uploadedAt');
  });
});

// BugFix-21 (review #3): the collector itself is covered, so a regex
// regression (e.g. dropping double-quote support) fails a test.
describe('collectStaticKeys', () => {
  it('collects keys in both quote styles', () => {
    expect(collectStaticKeys(`t('policies.a'); t("policies.b"); notT('policies.c')`)).toEqual([
      'policies.a',
      'policies.b',
    ]);
  });
});
