/**
 * AP-24 (§2): document classes of the documents tab as pure functions.
 *
 * The values mirror the `DocumentClass` enum of the API. Unknown or missing
 * values fall back to `UNCLASSIFIED` – the default for new and existing
 * documents, so legacy responses stay renderable.
 *
 * The repository has no DOM test harness, so everything that can be tested
 * without a browser lives here and is covered by
 * `src/__tests__/document-class.spec.ts`.
 */

export type DocumentClass =
  | 'CONTRACT'
  | 'BILLING'
  | 'CORRESPONDENCE'
  | 'CLAIM'
  | 'OTHER'
  | 'UNCLASSIFIED';

/** All classes in the order they are offered in the filter and the select. */
export const DOCUMENT_CLASSES: DocumentClass[] = [
  'UNCLASSIFIED',
  'CONTRACT',
  'BILLING',
  'CORRESPONDENCE',
  'CLAIM',
  'OTHER',
];

export const DEFAULT_DOCUMENT_CLASS: DocumentClass = 'UNCLASSIFIED';

/**
 * The two classes the work package treats as binding: `CONTRACT` feeds the
 * optional AI benefit summary, `BILLING` feeds the cost sidebar.
 */
export const CONTRACT_CLASS: DocumentClass = 'CONTRACT';
export const BILLING_CLASS: DocumentClass = 'BILLING';

/** Unknown or empty values become `UNCLASSIFIED` instead of leaking as-is. */
export function normalizeDocumentClass(
  value: string | null | undefined,
): DocumentClass {
  return (DOCUMENT_CLASSES as string[]).includes(value ?? '')
    ? (value as DocumentClass)
    : DEFAULT_DOCUMENT_CLASS;
}

const CLASS_LABEL_KEYS: Record<DocumentClass, string> = {
  CONTRACT: 'policies.classCONTRACT',
  BILLING: 'policies.classBILLING',
  CORRESPONDENCE: 'policies.classCORRESPONDENCE',
  CLAIM: 'policies.classCLAIM',
  OTHER: 'policies.classOTHER',
  UNCLASSIFIED: 'policies.classUNCLASSIFIED',
};

export function documentClassLabelKey(value: DocumentClass): string {
  return CLASS_LABEL_KEYS[value];
}

/**
 * AP-24 (§2.3): the class is shown as a badge in the document list.
 *
 * The mapping reuses the existing badge variants instead of introducing a
 * second badge style: `CONTRACT` and `BILLING` are the two classes the rest
 * of the application acts upon, so they get the two accentuated variants,
 * while `UNCLASSIFIED` – the default for every new document – deliberately
 * stays neutral and must not look like an active designation.
 */
const CLASS_BADGE_VARIANTS: Record<DocumentClass, string> = {
  CONTRACT: 'badge-accent',
  BILLING: 'badge-success',
  CORRESPONDENCE: 'badge-neutral',
  CLAIM: 'badge-warning',
  OTHER: 'badge-neutral',
  UNCLASSIFIED: 'badge-neutral',
};

export function documentClassBadgeClass(value: DocumentClass): string {
  return `badge ${CLASS_BADGE_VARIANTS[value]}`;
}

/**
 * Filter value of the class select. `null` means "no filter" – the value is
 * deliberately not part of `DOCUMENT_CLASSES` so it cannot be mistaken for a
 * real class.
 */
export const ALL_DOCUMENT_CLASSES = 'ALL';

export type DocumentClassFilter = DocumentClass | typeof ALL_DOCUMENT_CLASSES;

export const DOCUMENT_CLASS_FILTERS: DocumentClassFilter[] = [
  ALL_DOCUMENT_CLASSES,
  ...DOCUMENT_CLASSES,
];

export function documentClassFilterLabelKey(value: DocumentClassFilter): string {
  return value === ALL_DOCUMENT_CLASSES
    ? 'policies.classAll'
    : documentClassLabelKey(value);
}

/** `null` for "ALL" so the API query parameter can simply be omitted. */
export function documentClassFilterValue(
  value: DocumentClassFilter,
): DocumentClass | null {
  return value === ALL_DOCUMENT_CLASSES ? null : value;
}

// --- Bulk selection (AP-24 §2.3) -------------------------------------------

/**
 * Toggles one document in the bulk selection. Selecting an already selected
 * entry removes it again, so the checkbox behaves the way users expect.
 *
 * The returned array is a copy – React state must never be mutated in place.
 */
export function toggleSelected(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Keeps only the IDs that are still part of `documents` (e.g. after the list
 * was reloaded or filtered). Prevents a stale selection from silently
 * reclassifying a document the user can no longer see.
 */
export function pruneSelection(ids: string[], documents: { id: string }[]): string[] {
  const known = new Set(documents.map((doc) => doc.id));
  return ids.filter((id) => known.has(id));
}
