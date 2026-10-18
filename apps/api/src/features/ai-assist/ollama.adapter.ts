import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SettingsResolverService } from '@versigo/foundation';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import {
  COST_EXTRACTION_SYSTEM_PROMPT,
  COVERAGE_SUMMARY_SYSTEM_PROMPT,
  type IAIAdapter,
  type AiCostExtractionResult,
  type AiExtractResult,
  type AiSummarizeResult,
  type AiSummarizeOptions,
  type AiHealthStatus,
} from '@versigo/foundation';
import { tryParseExtractionResponse } from './ai-json.helper';
import { classifyAiHealthError } from './ai-health-error.helper';
import { optionalRelaxedHttpsAgent } from '../../common/connectivity/tls-agent';

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

const EXTRACTION_SYSTEM_PROMPT = `Du extrahierst Versicherungsvertragsdaten aus Dokumenten.
Antworte NUR mit einem gueltigen JSON-Objekt, das folgende Felder enthalten kann:
{
  "insurerName": "Name der Versicherungsgesellschaft oder null",
  "contractNumber": "Vertragsnummer oder null",
  "tariffName": "Tarifbezeichnung oder null",
  "insuranceType": "Art der Versicherung (z.B. HAFTPFLICHT, HAUSRAT, KFZ) oder null",
  "startDate": "Versicherungsbeginn im ISO-Format oder null",
  "endDate": "Versicherungsende im ISO-Format oder null",
  "premiumAmount": "Beitragshoehe als Zahl oder null",
  "paymentFrequency": "Zahlintervall (MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL) oder null",
  "deductibleAmount": "Selbstbeteiligung als Zahl oder null",
  "coveredPersons": [{"name": "Name", "relation": "Beziehung (z.B. EHEPARTNER, KIND)"}]
}

Jedes Feld muss einen confidence-Wert zwischen 0 und 1 haben.
Antworte NUR mit JSON, keinem anderen Text.`;

interface OllamaRuntimeConfig {
  baseUrl: string;
  model: string;
  timeout: number;
  /** BugFix-06: HTTPS agent with certificate validation disabled (opt-in). */
  httpsAgent?: import('https').Agent;
}

/**
 * Ollama adapter (AP-17): reads its configuration per call via the
 * central settings resolution (UI > .env > default). Admin-UI changes
 * to AI_OLLAMA_BASE_URL/-MODEL/-TIMEOUT take effect immediately,
 * without a restart.
 */
@Injectable()
export class OllamaAdapter implements IAIAdapter {
  private readonly logger = new Logger(OllamaAdapter.name);
  readonly providerKey = 'ollama';

  constructor(
    private readonly httpService: HttpService,
    private readonly settings: SettingsResolverService,
  ) {}

  private async runtimeConfig(): Promise<OllamaRuntimeConfig> {
    const baseUrl = (
      (await this.settings.getEffectiveString('AI_OLLAMA_BASE_URL')) ?? 'http://localhost:11434'
    ).replace(/\/+$/, '');
    const model = (await this.settings.getEffectiveString('AI_OLLAMA_MODEL')) ?? 'llama3';
    const timeout =
      (await this.settings.getEffectiveNumber('AI_EXTRACTION_TIMEOUT_MS')) ?? 60000;
    const relaxedAgent = await optionalRelaxedHttpsAgent(this.settings);
    return { baseUrl, model, timeout, ...relaxedAgent };
  }

  private async chatCompletion(
    systemPrompt: string,
    userContent: string,
    config: OllamaRuntimeConfig,
  ): Promise<string | null> {
    const url = `${config.baseUrl}/api/chat`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<OllamaChatResponse>(
          url,
          {
            model: config.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            stream: false,
          },
          {
            timeout: config.timeout,
            ...(config.httpsAgent !== undefined ? { httpsAgent: config.httpsAgent } : {}),
          },
        ),
      );
      return data.message?.content ?? null;
    } catch (err) {
      this.logError('chat', err);
      return null;
    }
  }

  private buildExtractionPrompt(documentContents: string[]): string {
    return `Extrahiere Vertragsdaten aus folgenden Dokumenten:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}\n\nAntworte NUR mit JSON.`;
  }

  private buildSummarizePrompt(documentContents: string[], options?: AiSummarizeOptions): string {
    const base = `Fasse folgende Versicherungsdokumente zusammen:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}`;
    // AP-24 (§3.2): the single bounded retry explains what was wrong with the
    // previous answer – and only that, never additional document content.
    if (options?.repairHint) {
      return `${base}\n\nKORREKTURHINWEIS: ${options.repairHint}`;
    }
    return base;
  }

  /** AP-24 (§4.2): prompt for a single billing document. */
  private buildCostExtractionPrompt(
    documentContent: string,
    options?: AiSummarizeOptions,
  ): string {
    const base = `Lies die Beitragsdaten aus folgendem Dokument:\n\n--- Dokument ---\n${documentContent}`;
    if (options?.repairHint) {
      return `${base}\n\nKORREKTURHINWEIS: ${options.repairHint}`;
    }
    return base;
  }

  async extractContractFacts(
    documentContents: string[],
    _policyId: string,
  ): Promise<AiExtractResult | null> {
    void _policyId;

    if (documentContents.length === 0) return null;

    const config = await this.runtimeConfig();
    const raw = await this.chatCompletion(
      EXTRACTION_SYSTEM_PROMPT,
      this.buildExtractionPrompt(documentContents),
      config,
    );

    if (!raw) return null;

    const parsed = tryParseExtractionResponse(raw, config.model);
    if (!parsed) {
      this.logger.warn(`Could not parse JSON from AI response: ${raw.substring(0, 200)}`);
      return null;
    }

    return {
      fields: parsed.fields,
      confidence: parsed.confidence,
      model: parsed.model,
    };
  }

  async summarizeCoverage(
    documentContents: string[],
    _policyId: string,
    options?: AiSummarizeOptions,
  ): Promise<AiSummarizeResult | null> {
    void _policyId;

    if (documentContents.length === 0) return null;

    const config = await this.runtimeConfig();
    const raw = await this.chatCompletion(
      COVERAGE_SUMMARY_SYSTEM_PROMPT,
      this.buildSummarizePrompt(documentContents, options),
      config,
    );

    if (!raw) return null;

    return {
      summaryMarkdown: raw,
      sourceDocumentRefs: [],
      model: config.model,
    };
  }

  /**
   * AP-24 (§4.2): reads cost data from a single billing document.
   *
   * The answer stays raw here on purpose – only `AiAssistService` validates
   * and converts it, so every adapter shares exactly one contract.
   */
  async extractCostFromDocument(
    documentContent: string,
    _policyId: string,
    options?: AiSummarizeOptions,
  ): Promise<AiCostExtractionResult | null> {
    void _policyId;

    if (documentContent.trim() === '') return null;

    const config = await this.runtimeConfig();
    const raw = await this.chatCompletion(
      COST_EXTRACTION_SYSTEM_PROMPT,
      this.buildCostExtractionPrompt(documentContent, options),
      config,
    );

    if (!raw) return null;

    return { costJson: raw, model: config.model };
  }

  async healthCheck(): Promise<boolean> {
    return (await this.healthStatus()).connected;
  }

  /**
   * Detailed health check (BugFix-22) with a machine-readable reason, so
   * the UI can say WHY Ollama does not answer (e.g. "unreachable" when the
   * container's localhost has no Ollama) instead of a generic message.
   */
  async healthStatus(): Promise<AiHealthStatus> {
    const config = await this.runtimeConfig();
    const url = `${config.baseUrl}/api/tags`;
    try {
      const { status } = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 5_000,
          validateStatus: () => true,
          ...(config.httpsAgent !== undefined ? { httpsAgent: config.httpsAgent } : {}),
        }),
      );
      if (status >= 200 && status < 300) return { connected: true, reason: null };
      if (status === 401 || status === 403) return { connected: false, reason: 'unauthorized' };
      return { connected: false, reason: 'http-error' };
    } catch (err) {
      return { connected: false, reason: classifyAiHealthError(err) };
    }
  }

  private logError(method: string, err: unknown): void {
    if (err instanceof AxiosError) {
      this.logger.warn(
        `Ollama API ${method} failed: status=${err.response?.status ?? 'no response'}, message=${err.message}`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`Ollama API ${method} error: ${err.message}`);
    } else {
      this.logger.warn(`Ollama API ${method} unknown error`);
    }
  }
}
