import type {
  IPaperlessAdapter,
  PaperlessDocumentMetadata,
  PaperlessSyncResult,
  PaperlessSearchResult,
} from './paperless-ngx.interface';

/**
 * NoOp-Implementierung des Paperless-Adapters.
 * Wird injiziert, wenn Paperless-ngx deaktiviert ist (Standardfall).
 * Alle Methoden geben null oder leere Ergebnisse zurueck und
 * blockieren keine Kernfunktionen.
 */
export class NoOpPaperlessAdapter implements IPaperlessAdapter {
  async getDeepLink(_paperlessId: number): Promise<string | null> {
    void _paperlessId;
    return null;
  }

  async getDocumentMetadata(_paperlessId: number): Promise<PaperlessDocumentMetadata | null> {
    void _paperlessId;
    return null;
  }

  async syncDocument(_paperlessId: number): Promise<PaperlessSyncResult> {
    void _paperlessId;
    return { success: false, paperlessId: null, deepLink: null, error: 'Paperless deaktiviert' };
  }

  async searchDocuments(_query: string): Promise<PaperlessSearchResult[]> {
    void _query;
    return [];
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}
