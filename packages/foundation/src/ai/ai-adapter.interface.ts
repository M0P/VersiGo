/**
 * Shared interface for optional AI provider adapters.
 *
 * All methods return null or empty results on errors and never throw
 * exceptions. This ensures that an AI failure never blocks the policy or
 * document management flows.
 *
 * This interface is used by both the API feature slice (AiAssistService)
 * and the worker processor.
 */

export interface AiExtractResult {
  /** Raw extracted field data as a JSON-compatible object */
  fields: Record<string, unknown>;
  /** Confidence values (0-1) for each extracted field */
  confidence: Record<string, number>;
  /** Name of the model used */
  model: string;
}

export interface AiSummarizeResult {
  /** Summary in Markdown format */
  summaryMarkdown: string;
  /** List of document references included in the summary */
  sourceDocumentRefs: string[];
  /** Name of the model used */
  model: string;
}

export interface IAIAdapter {
  /**
   * Extracts contract facts from documents.
   * Returns null on error or when the configuration is missing.
   */
  extractContractFacts(
    documentContents: string[],
    policyId: string,
  ): Promise<AiExtractResult | null>;

  /**
   * Creates a summary of the insurance coverage.
   * Returns null on error or when the configuration is missing.
   */
  summarizeCoverage(
    documentContents: string[],
    policyId: string,
  ): Promise<AiSummarizeResult | null>;

  /**
   * Checks the connection to the AI provider.
   */
  healthCheck(): Promise<boolean>;

  /** Returns the provider key (e.g. 'ollama', 'openai-compat') */
  readonly providerKey: string;
}

export const AI_ADAPTER = Symbol('AI_ADAPTER');
