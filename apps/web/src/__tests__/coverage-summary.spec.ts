import { describe, it, expect } from 'vitest';

import { isCoverageSummaryDocument, legacyMarkdownBlocks } from '../lib/coverage-summary';

describe('coverage-summary helpers', () => {
  it('isCoverageSummaryDocument accepts only a matching runtime shape', () => {
    expect(isCoverageSummaryDocument(null)).toBe(false);
    expect(isCoverageSummaryDocument({})).toBe(false);
    expect(isCoverageSummaryDocument({ version: 1, sections: [], hints: 'x' })).toBe(false);
    expect(
      isCoverageSummaryDocument({
        version: 1,
        sections: [{ title: 's', items: ['a'], note: null }],
        hints: ['h'],
      }),
    ).toBe(true);
  });

  it('legacyMarkdownBlocks maps headings, lists and blank lines', () => {
    const blocks = legacyMarkdownBlocks('# Title\n\n## Sub\n- item 1\n- item 2\n\n');
    expect(blocks).toEqual([
      { kind: 'heading1', text: 'Title' },
      { kind: 'blank', text: '' },
      { kind: 'heading2', text: 'Sub' },
      { kind: 'listItem', text: 'item 1' },
      { kind: 'listItem', text: 'item 2' },
      { kind: 'blank', text: '' },
    ]);
  });

  it('legacyMarkdownBlocks does not invent a line from a trailing newline', () => {
    // "…" ends the last line, it does not open a new one – and an empty
    // summary stays empty instead of rendering a single blank block.
    expect(legacyMarkdownBlocks('- item 1')).toEqual([{ kind: 'listItem', text: 'item 1' }]);
    expect(legacyMarkdownBlocks('- item 1\n')).toEqual([{ kind: 'listItem', text: 'item 1' }]);
    expect(legacyMarkdownBlocks('')).toEqual([]);
    expect(legacyMarkdownBlocks(null)).toEqual([]);
    // CRLF from older stored summaries is normalised, not shown literally.
    expect(legacyMarkdownBlocks('# Title\r\n- item 1\r\n')).toEqual([
      { kind: 'heading1', text: 'Title' },
      { kind: 'listItem', text: 'item 1' },
    ]);
  });
});
