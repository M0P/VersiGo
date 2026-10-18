import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * BugFix-22 regression guard: after a SUCCESSFUL cost save
 * (POST .../costs) the submit button of the cost form stayed disabled
 * until a full page reload, so several entries could not be entered one
 * after another.
 *
 * Root cause: the success path calls `reload()`, and `reload()` itself
 * increments `requestSeq.current`. The `.finally` block of the same
 * promise chain still used the captured (now stale) `seq`, so
 * `if (seq === requestSeq.current) setSubmitting(false)` never ran and
 * `disabled={submitting}` stayed `true` forever. The error path (no
 * `reload()`) worked, which is why only successful saves blocked the
 * button.
 *
 * The flag is a pure UI lock: exactly one submit can be active at a time
 * (the buttons are disabled while `submitting` is true), so clearing it
 * must never depend on the data-freshness sequence token. Every other
 * form in the codebase (new/edit policy, covered persons, portal links,
 * document upload) already clears its flag unconditionally in `finally`.
 *
 * The type system cannot catch this control-flow defect and the web test
 * suite has no DOM harness, so this guard reads the component and pins
 * the invariant at the source level (same approach as
 * documents-tab-i18n.spec.ts).
 */
const COMPONENT_PATH = fileURLToPath(
  new URL('../app/policies/[id]/costs-overview-card.tsx', import.meta.url),
);

/** The defective guard pattern (kept as a fixture to guard the guard). */
const SEQ_GUARDED_RESET =
  /if\s*\(\s*seq\s*===\s*requestSeq\.current\s*\)\s*setSubmitting\(false\)/;

/** Bodies of all `.finally(() => { … })` blocks of the component. */
function collectFinallyBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /\.finally\(\(\)\s*=>\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    // The finally bodies in this component contain no nested braces;
    // scan from the opening brace of the body to its matching close.
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(start + 1, i));
          break;
        }
      }
    }
  }
  return blocks;
}

describe('costs overview card submit flag', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

  it('finds both submit promise chains (create + update)', () => {
    // Guards the guard: if the scanner finds nothing, the assertions
    // below must not silently pass.
    const blocks = collectFinallyBlocks(source).filter((b) =>
      b.includes('setSubmitting'),
    );
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it('clears setSubmitting(false) in every submit .finally block', () => {
    for (const block of collectFinallyBlocks(source)) {
      if (block.includes('setSubmitting')) {
        expect(block).toMatch(/setSubmitting\(false\)/);
      }
    }
  });

  it('never gates setSubmitting(false) on the request sequence token', () => {
    expect(source).not.toMatch(SEQ_GUARDED_RESET);
  });
});

describe('collectFinallyBlocks', () => {
  it('collects blocks with nested parentheses and reports body content', () => {
    const source = `fetch(x).finally(() => { if (seq === s) setSubmitting(false); });`;
    expect(collectFinallyBlocks(source)).toEqual([
      ' if (seq === s) setSubmitting(false); ',
    ]);
  });
});
