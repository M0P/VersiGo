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

/**
 * Machine-readable reason why a provider is not available (BugFix-22).
 *
 * The values are deliberately coarse and never contain URLs,
 * credentials or response bodies – they exist so that the UI can say
 * WHY the configured provider does not answer instead of always
 * claiming the provider is down.
 */
export type AiHealthReason =
  /** AI_ENABLED is off (or an unknown provider key fell back to NoOp). */
  | 'disabled'
  /** Required settings (e.g. base URL) are missing. */
  | 'not-configured'
  /** The provider answered HTTP 401/403 – credentials are wrong. */
  | 'unauthorized'
  /** The provider did not answer within the probe timeout. */
  | 'timeout'
  /** Connection/DNS level failure – the provider is not reachable. */
  | 'unreachable'
  /** The provider answered with any other non-2xx status. */
  | 'http-error';

export interface AiHealthStatus {
  connected: boolean;
  /** `null` while connected, otherwise the reason why not. */
  reason: AiHealthReason | null;
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

  /**
   * Detailed health check with a machine-readable reason (BugFix-22).
   * Optional so that third-party adapters only implementing
   * `healthCheck()` keep working; consumers fall back to it.
   */
  healthStatus?(): Promise<AiHealthStatus>;

  /** Returns the provider key (e.g. 'ollama', 'openai-compat') */
  readonly providerKey: string;
}

export const AI_ADAPTER = Symbol('AI_ADAPTER');
