import { Injectable } from '@nestjs/common';
import type {
  IAIAdapter,
  AiExtractResult,
  AiSummarizeResult,
  AiHealthStatus,
} from '@versigo/foundation';

/**
 * NoOp-Implementierung des AI-Adapters.
 * Injected when AI is disabled (default case).
 * All methods return null or empty results and
 * do not block core functions.
 */
@Injectable()
export class NoOpAIAdapter implements IAIAdapter {
  readonly providerKey = 'none';

  async extractContractFacts(
    _documentContents: string[],
    _policyId: string,
  ): Promise<AiExtractResult | null> {
    void _documentContents;
    void _policyId;
    return null;
  }

  async summarizeCoverage(
    _documentContents: string[],
    _policyId: string,
  ): Promise<AiSummarizeResult | null> {
    void _documentContents;
    void _policyId;
    return null;
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }

  /**
   * BugFix-22: the reason is `not-configured` – either AI is disabled or
   * the configured provider key does not exist. `AiAssistService` maps the
   * disabled case to `disabled` before it reaches the UI.
   */
  async healthStatus(): Promise<AiHealthStatus> {
    return { connected: false, reason: 'not-configured' };
  }
}
