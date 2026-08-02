import { Injectable } from '@nestjs/common';
import type { IAIAdapter, AiExtractResult, AiSummarizeResult } from '@versigo/foundation';

/**
 * NoOp-Implementierung des AI-Adapters.
 * Wird injiziert, wenn AI deaktiviert ist (Standardfall).
 * Alle Methoden geben null oder leere Ergebnisse zurueck und
 * blockieren keine Kernfunktionen.
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
}
