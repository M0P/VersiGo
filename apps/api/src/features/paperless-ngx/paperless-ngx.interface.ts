/**
 * Port/Interface fuer den Paperless-ngx-Adapter.
 *
 * Alle Methoden sind so ausgelegt, dass sie niemals die Kernfunktionen
 * blockieren. Fehler in der Paperless-Kommunikation werden geloggt,
 * aber nicht weitergereicht.
 *
 * Wenn Paperless deaktiviert ist, wird eine NoOp-Implementierung
 * injiziert, die fuer jede Methode null zurueckgibt.
 */

export interface PaperlessDocumentRef {
  /** Paperless-interner Dokumenten-ID */
  paperlessId: number;
  /** API-Deep-Link-URL zum Dokument */
  deepLink: string;
  /** Synchronisation einer Momentaufnahme der Metadaten */
  metadata: PaperlessDocumentMetadata | null;
  /** Status der letzten Synchronisation */
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
   * Erzeugt aus einem Paperless-Dokumentenverweis einen Deep Link.
   * Gibt null zurueck, wenn das Dokument in Paperless nicht existiert.
   */
  getDeepLink(paperlessId: number): Promise<string | null>;

  /**
   * Ruft Metadaten eines Paperless-Dokuments ab.
   * Gibt null bei Fehler oder fehlendem Dokument zurueck.
   */
  getDocumentMetadata(paperlessId: number): Promise<PaperlessDocumentMetadata | null>;

  /**
   * Synchronisiert Metadaten eines Dokuments.
   */
  syncDocument(paperlessId: number): Promise<PaperlessSyncResult>;

  /**
   * Sucht nach Dokumenten in Paperless anhand eines Suchbegriffs.
   *
   * Hinweis: Aktuell wird nur die erste Suchergebnisseite zurueckgegeben.
   * Bei grossen Ergebnismengen sollte die Paginierung implementiert werden.
   */
  searchDocuments(query: string): Promise<PaperlessSearchResult[]>;

  /**
   * Prueft die Verbindung zur Paperless-API.
   */
  healthCheck(): Promise<boolean>;
}

export const PAPERLESS_ADAPTER = Symbol('PAPERLESS_ADAPTER');
