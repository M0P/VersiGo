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

  /**
   * Checks the connection to the Paperless API.
   */
  healthCheck(): Promise<boolean>;
}

export const PAPERLESS_ADAPTER = Symbol('PAPERLESS_ADAPTER');
