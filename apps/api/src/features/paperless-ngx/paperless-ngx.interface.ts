/**
 * Port/interface for the Paperless-ngx adapter.
 *
 * All methods are designed to never block the core functionality. Errors in
 * the Paperless communication are logged, but never passed through.
 *
 * When Paperless is disabled (or no token is configured), the adapter itself
 * returns null; a separate NoOp implementation no longer exists (BugFix-07:
 * dead code removed).
 */

export interface PaperlessDocumentRef {
  /** Paperless-internal document ID */
  paperlessId: number;
  /** API deep-link URL to the document */
  deepLink: string;
  /** Snapshot of the metadata synchronization */
  metadata: PaperlessDocumentMetadata | null;
  /** Status of the last synchronization */
  syncStatus: 'ok' | 'error' | 'not_synced';
}

export interface PaperlessDocumentMetadata {
  title: string | null;
  tags: string[];
  correspondent: string | null;
  documentType: string | null;
  notes: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

export interface PaperlessSyncResult {
  success: boolean;
  paperlessId: number | null;
  deepLink: string | null;
  error?: string;
}

export interface PaperlessSearchResult {
  paperlessId: number;
  title: string;
  deepLink: string;
  tags: string[];
  correspondent: string | null;
}

/** AP-22: summary of a Paperless tag (ID is the stable reference). */
export interface PaperlessTagSummary {
  tagId: number;
  name: string;
}

/** AP-22: paginated page of tag search results. */
export interface PaperlessTagPage {
  items: PaperlessTagSummary[];
  /** Page number of this page (1-based). */
  page: number;
  /** Total number of pages according to the API. */
  pageCount: number;
}

/** AP-22: minimal document reference used by the tag sync. */
export interface PaperlessTagDocumentRef {
  paperlessId: number;
  title: string | null;
}

/**
 * AP-22: how the Paperless API reported a tag lookup failure. Lets the
 * caller distinguish "missing permissions" from "really deleted".
 */
export type PaperlessTagLookupError =
  | { kind: 'NOT_FOUND' }
  | { kind: 'AUTH_FAILED' }
  | { kind: 'UNREACHABLE' }
  | { kind: 'NOT_CONFIGURED' };

/** AP-22: result of a single tag lookup with explicit failure kind. */
export type PaperlessTagLookupResult =
  | { ok: true; tag: PaperlessTagSummary }
  | { ok: false; error: PaperlessTagLookupError };

/**
 * AP-22: why an *interactive* tag operation (search / creation) could not be
 * completed. Deliberately the same vocabulary as `PaperlessTagLookupError`
 * without NOT_FOUND: a connection or permission problem must never surface
 * as "no matching tag" in the UI.
 */
export type PaperlessTagRequestError =
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'AUTH_FAILED' }
  | { kind: 'UNREACHABLE' }
  | { kind: 'REJECTED' };

/**
 * AP-22: result of a paginated tag search. On failure the reason is
 * reported explicitly instead of an empty page.
 */
export type PaperlessTagSearchResult =
  | { ok: true; page: PaperlessTagPage }
  | { ok: false; error: PaperlessTagRequestError };

/** AP-22: result of a tag creation with explicit failure reason. */
export type PaperlessTagCreateResult =
  | { ok: true; tag: PaperlessTagSummary }
  | { ok: false; error: PaperlessTagRequestError };

/** AP-22: result of an additive tag assignment onto a document. */
export interface PaperlessTagAssignmentResult {
  success: boolean;
  /** True only after the tag was verified present on the document. */
  verified: boolean;
  /**
   * Non-sensitive error code (NOT_CONFIGURED, DOCUMENT_NOT_FOUND,
   * AUTH_FAILED, VERIFY_FAILED, …). Kept identical to the worker client's
   * `TagAssignmentResult.errorCode` so a stored `taggingErrorCode` means the
   * same thing regardless of which process produced it.
   */
  errorCode?: string;
}

export interface IPaperlessAdapter {
  /**
   * Builds a deep link from a Paperless document reference.
   * Returns null if the document does not exist in Paperless.
   */
  getDeepLink(paperlessId: number): Promise<string | null>;

  /**
   * Fetches metadata of a Paperless document.
   * Returns null on error or missing document.
   */
  getDocumentMetadata(paperlessId: number): Promise<PaperlessDocumentMetadata | null>;

  /**
   * Synchronizes metadata of a document.
   */
  syncDocument(paperlessId: number): Promise<PaperlessSyncResult>;

  /**
   * Searches Paperless documents by a search term.
   *
   * Note: currently only the first result page is returned. For large result
   * sets pagination should be implemented.
   */
  searchDocuments(query: string): Promise<PaperlessSearchResult[]>;

  // --- AP-22: tag-based document assignment -------------------------------

  /**
   * Searches Paperless tags by name (paginated). An empty query lists all
   * tags in stable (ID) order. A configuration or connection failure is
   * reported explicitly instead of an empty page, so the caller can explain
   * why nothing was found.
   */
  searchTags(query: string, page: number, pageSize: number): Promise<PaperlessTagSearchResult>;

  /**
   * Fetches a single tag by its external ID. The result distinguishes
   * NOT_FOUND (really deleted) from AUTH_FAILED (missing permissions)
   * and UNREACHABLE (network/outage) so callers can react differently.
   */
  getTag(tagId: number): Promise<PaperlessTagLookupResult>;

  /**
   * Creates a new tag with the given name. When a tag with the identical
   * name already exists, that existing tag is returned instead of failing
   * (idempotent). Every failure carries its explicit reason.
   */
  createTag(name: string): Promise<PaperlessTagCreateResult>;

  /**
   * Lists all document IDs (with titles) carrying the given tag, walking
   * ALL result pages in stable order. Returns null on any failure so the
   * caller can keep the previous assignment state (no partial results).
   */
  listDocumentsByTag(tagId: number): Promise<PaperlessTagDocumentRef[] | null>;

  /**
   * Additively assigns a tag to a document (existing tags are preserved)
   * and verifies the result by re-reading the document. A merely accepted
   * job is NOT reported as success – only a verified tag presence is.
   */
  assignTagToDocument(paperlessDocumentId: number, tagId: number): Promise<PaperlessTagAssignmentResult>;

  /**
   * Checks the connection to the Paperless API.
   */
  healthCheck(): Promise<boolean>;
}

export const PAPERLESS_ADAPTER = Symbol('PAPERLESS_ADAPTER');
