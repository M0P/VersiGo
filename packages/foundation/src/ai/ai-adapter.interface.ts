/**
 * Gemeinsames Interface fuer optionale AI-Provider-Adapter.
 *
 * Alle Methoden geben bei Fehlern null oder leere Ergebnisse zurueck,
 * niemals werfen sie Exceptions. Das stellt sicher, dass ein AI-Ausfall
 * nie die Vertrags- oder Dokumentenverwaltung blockiert.
 *
 * Dieses Interface wird sowohl vom API-Feature-Slice (AiAssistService)
 * als auch vom Worker-Prozessor verwendet.
 */

export interface AiExtractResult {
  /** Rohdaten der extrahierten Felder als JSON-kompatibles Objekt */
  fields: Record<string, unknown>;
  /** Konfidenz-Werte (0-1) fuer jedes extrahierte Feld */
  confidence: Record<string, number>;
  /** Name des verwendeten Modells */
  model: string;
}

export interface AiSummarizeResult {
  /** Zusammenfassung in Markdown-Format */
  summaryMarkdown: string;
  /** Liste der Dokumenten-Referenzen, die in die Zusammenfassung eingeflossen sind */
  sourceDocumentRefs: string[];
  /** Name des verwendeten Modells */
  model: string;
}

export interface IAIAdapter {
  /**
   * Extrahiert Vertragsfakten aus Dokumenten.
   * Gibt null bei Fehler oder fehlender Konfiguration zurueck.
   */
  extractContractFacts(
    documentContents: string[],
    policyId: string,
  ): Promise<AiExtractResult | null>;

  /**
   * Erstellt eine Zusammenfassung des Versicherungsschutzes.
   * Gibt null bei Fehler oder fehlender Konfiguration zurueck.
   */
  summarizeCoverage(
    documentContents: string[],
    policyId: string,
  ): Promise<AiSummarizeResult | null>;

  /**
   * Prueft die Verbindung zum AI-Provider.
   */
  healthCheck(): Promise<boolean>;

  /** Gibt den Provider-Schluessel zurueck (z. B. 'ollama', 'openai-compat') */
  readonly providerKey: string;
}

export const AI_ADAPTER = Symbol('AI_ADAPTER');
