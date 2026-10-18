import type { IconName } from '@/components/ui/icons';

/**
 * BugFix-22: view logic of the documents tab as pure functions.
 *
 * The repository has no DOM test harness (see `vitest.config.ts`, node
 * environment), so the sort order and the origin mapping are implemented here
 * and covered by `documents-view.spec.ts` instead of an untested JSX tweak.
 */

// --- Sorting ---------------------------------------------------------------

export type DocumentSortKey = 'dateDesc' | 'dateAsc' | 'nameAsc' | 'nameDesc';

/** All sort orders offered by the documents tab, in display order. */
export const DOCUMENT_SORT_KEYS: DocumentSortKey[] = [
  'dateDesc',
  'dateAsc',
  'nameAsc',
  'nameDesc',
];

/** Newest first – the historical behaviour of the list. */
export const DEFAULT_DOCUMENT_SORT: DocumentSortKey = 'dateDesc';

export function documentSortLabelKey(key: DocumentSortKey): string {
  return `policies.documentSort.${key}`;
}

/** Minimum shape the list has to provide for sorting. */
export type SortableDocument = {
  fileName: string;
  documentDate?: string | null;
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Case-insensitive, locale-aware comparison of two file names. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base', numeric: true });
}

/**
 * Date comparison; documents without a date always come last (`direction` is
 * `1` for oldest first and `-1` for newest first).
 */
function compareDates(
  a: SortableDocument,
  b: SortableDocument,
  direction: 1 | -1,
): number {
  const left = timestamp(a.documentDate);
  const right = timestamp(b.documentDate);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

/**
 * Sorts a copy of `documents` (React state must stay untouched). The sort is
 * stable, so equal entries keep their original order and documents without a
 * date do not shuffle around.
 */
export function sortDocuments<T extends SortableDocument>(
  documents: T[],
  key: DocumentSortKey,
): T[] {
  const sorted = [...documents];
  switch (key) {
    case 'nameAsc':
      return sorted.sort((a, b) => compareNames(a.fileName, b.fileName));
    case 'nameDesc':
      return sorted.sort((a, b) => compareNames(b.fileName, a.fileName));
    case 'dateAsc':
      return sorted.sort((a, b) => compareDates(a, b, 1));
    case 'dateDesc':
    default:
      return sorted.sort((a, b) => compareDates(a, b, -1));
  }
}

// --- Origin of a Paperless assignment --------------------------------------

export type DocumentOriginKind = 'auto' | 'manual' | 'both';

/** All origin kinds that can be derived from the two origin flags. */
export const DOCUMENT_ORIGIN_KINDS: DocumentOriginKind[] = ['auto', 'manual', 'both'];

export function documentOriginKind(doc: {
  linkOriginTag?: boolean;
  linkOriginManual?: boolean;
}): DocumentOriginKind | null {
  if (doc.linkOriginTag && doc.linkOriginManual) return 'both';
  if (doc.linkOriginTag) return 'auto';
  if (doc.linkOriginManual) return 'manual';
  return null;
}

const ORIGIN_ICONS: Record<DocumentOriginKind, IconName> = {
  auto: 'linkTag',
  manual: 'linkManual',
  both: 'linkBoth',
};

/**
 * Icon of an origin. BugFix-22: the origin is shown as a compact icon instead
 * of a text badge – the accessible name is the localized label (see
 * `documentOriginLabelKey`), so no information is lost.
 */
export function documentOriginIcon(kind: DocumentOriginKind): IconName {
  return ORIGIN_ICONS[kind];
}

const ORIGIN_LABEL_KEYS: Record<DocumentOriginKind, string> = {
  auto: 'policies.paperlessOriginAuto',
  manual: 'policies.paperlessOriginManual',
  both: 'policies.paperlessOriginBoth',
};

export function documentOriginLabelKey(kind: DocumentOriginKind): string {
  return ORIGIN_LABEL_KEYS[kind];
}
