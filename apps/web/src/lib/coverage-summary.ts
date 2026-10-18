/**
 * AP-24 (§3.2): shared, testable helpers for rendering an AI coverage summary.
 *
 * The API validates every answer against the versioned schema before it is
 * stored or returned (see `packages/foundation/src/ai/coverage-summary-format.ts`).
 * The web app still does not trust the payload blindly:
 *
 * - `isCoverageSummaryDocument` re-checks the shape at runtime, so a summary
 *   from an older/newer API version degrades to the legacy rendering instead
 *   of crashing the page.
 * - `legacyMarkdownBlocks` converts the pre-AP-24 Markdown summaries into
 *   plain text blocks. The renderer turns them into React elements; the text
 *   itself is never interpreted as HTML, so script or markup inside a model
 *   answer is displayed literally and never executed.
 */

export interface CoverageSummarySection {
  title: string;
  items: string[];
  note: string | null;
}

export interface CoverageSummaryDocument {
  version: number;
  sections: CoverageSummarySection[];
  hints: string[];
}

/** Runtime shape check for the structured summary of the API. */
export function isCoverageSummaryDocument(value: unknown): value is CoverageSummaryDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;

  if (typeof root.version !== 'number' || !Number.isInteger(root.version)) return false;
  if (!Array.isArray(root.sections)) return false;
  if (!Array.isArray(root.hints) || root.hints.some((hint) => typeof hint !== 'string')) return false;

  return root.sections.every((section) => {
    if (typeof section !== 'object' || section === null || Array.isArray(section)) return false;
    const entry = section as Record<string, unknown>;
    if (typeof entry.title !== 'string') return false;
    if (!Array.isArray(entry.items) || entry.items.some((item) => typeof item !== 'string')) return false;
    if (entry.note !== null && entry.note !== undefined && typeof entry.note !== 'string') return false;
    return true;
  });
}

export type LegacyBlockKind = 'heading1' | 'heading2' | 'listItem' | 'paragraph' | 'blank';

export interface LegacyBlock {
  kind: LegacyBlockKind;
  text: string;
}

/**
 * Converts a stored pre-AP-24 Markdown summary into displayable blocks.
 *
 * Deliberately a very small subset (as before AP-24): `#`, `##`, `- ` and
 * paragraphs. Everything else – including inline markup, links or raw HTML –
 * stays literal text, because it is rendered as text and not as markup.
 */
export function legacyMarkdownBlocks(markdown: string | null | undefined): LegacyBlock[] {
  const text = (markdown ?? '').replace(/\r\n/g, '\n');

  // A trailing newline terminates the last line, it does not start another
  // one – without this a stored summary ending in "\n" would render one empty
  // block more than it contains.
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  return lines.map((line) => {
    if (line.startsWith('# ')) return { kind: 'heading1' as const, text: line.slice(2) };
    if (line.startsWith('## ')) return { kind: 'heading2' as const, text: line.slice(3) };
    if (line.startsWith('- ')) return { kind: 'listItem' as const, text: line.slice(2) };
    if (line.trim() === '') return { kind: 'blank' as const, text: '' };
    return { kind: 'paragraph' as const, text: line };
  });
}
