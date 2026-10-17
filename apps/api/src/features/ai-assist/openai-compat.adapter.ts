import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SettingsResolverService } from '@versigo/foundation';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import type {
  IAIAdapter,
  AiExtractResult,
  AiSummarizeResult,
  AiHealthStatus,
  AiHealthReason,
} from '@versigo/foundation';
import { tryParseExtractionResponse } from './ai-json.helper';
import { classifyAiHealthError } from './ai-health-error.helper';
import { optionalRelaxedHttpsAgent } from '../../common/connectivity/tls-agent';

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiChatRequest {
  model: string;
  messages: OpenAiChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface OpenAiChatChoice {
  message: OpenAiChatMessage;
  finish_reason: string;
}

interface OpenAiChatResponse {
  id: string;
  model: string;
  choices: OpenAiChatChoice[];
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

const SUMMARIZE_SYSTEM_PROMPT = `Du fasst Versicherungsvertraege zusammen.
Erstelle eine praegnante Zusammenfassung in deutscher Sprache im Markdown-Format.
Wenn vorhanden, gib Deckungssummen, Ausschluesse, Selbstbehalte und Kuendigungsfristen an.
Halte die Zusammenfassung auf max. 500 Zeichen.`;

interface OpenAiRuntimeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
  configured: boolean;
  /** BugFix-06: HTTPS agent with disabled certificate validation (opt-in). */
  httpsAgent?: import('https').Agent;
}

/** Health probe timeout (kept short: it runs on the policy detail page). */
const HEALTH_TIMEOUT_MS = 5_000;
/**
 * How long a successful fallback probe is reused (BugFix-22). The fallback
 * costs a minimal completion request, so it must not run on every page view.
 */
const HEALTH_FALLBACK_TTL_MS = 60_000;

/**
 * OpenAI-compatible adapter (AP-17): reads its configuration per call
 * via the central settings resolution (UI > .env > default). This
 * means admin UI changes to AI_OPENAI_COMPAT_* take effect immediately,
 * without a restart.
 * The API key is supplied internally decrypted and never logged.
 *
 * BugFix-22: an API key is optional – many OpenAI-compatible endpoints
 * (local gateways, vLLM, LM Studio, Ollama's OpenAI API) run without
 * authentication. Previously a missing key silently marked the provider
 * as "not configured", so the UI reported "the configured provider does
 * not answer" although every connectivity test returned HTTP 200.
 */
@Injectable()
export class OpenAiCompatAdapter implements IAIAdapter {
  private readonly logger = new Logger(OpenAiCompatAdapter.name);
  readonly providerKey = 'openai-compat';

  /** Timestamp until which the successful `/chat/completions` fallback is reused. */
  private healthFallbackValidUntil = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly settings: SettingsResolverService,
  ) {}

  private async runtimeConfig(): Promise<OpenAiRuntimeConfig> {
    const baseUrl = (
      (await this.settings.getEffectiveString('AI_OPENAI_COMPAT_BASE_URL')) ?? ''
    ).replace(/\/+$/, '');
    const apiKey = (await this.settings.getEffectiveString('AI_OPENAI_COMPAT_API_KEY')) ?? '';
    const model = (await this.settings.getEffectiveString('AI_OPENAI_COMPAT_MODEL')) ?? 'gpt-4o-mini';
    const timeout =
      (await this.settings.getEffectiveNumber('AI_EXTRACTION_TIMEOUT_MS')) ?? 60000;
    // Only the base URL is required; the API key is optional (see JSDoc).
    const configured = baseUrl.length > 0;
    const relaxedAgent = await optionalRelaxedHttpsAgent(this.settings);

    if (configured && baseUrl.startsWith('http://')) {
      this.logger.warn(
        'AI_OPENAI_COMPAT_BASE_URL uses HTTP. The API key is transmitted ' +
          'in plaintext. Use https:// for production environments.',
      );
    }

    return { baseUrl, apiKey, model, timeout, configured, ...relaxedAgent };
  }

  /** Bearer header only when a key is configured (an empty `Bearer ` trips some gateways). */
  private authHeaders(config: OpenAiRuntimeConfig): Record<string, string> {
    return config.apiKey.length > 0 ? { Authorization: `Bearer ${config.apiKey}` } : {};
  }

  private async chatCompletion(
    systemPrompt: string,
    userContent: string,
    config: OpenAiRuntimeConfig,
  ): Promise<string | null> {
    if (!config.configured) return null;

    const url = `${config.baseUrl}/chat/completions`;

    const body: OpenAiChatRequest = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    };

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<OpenAiChatResponse>(url, body, {
          headers: {
            ...this.authHeaders(config),
            'Content-Type': 'application/json',
          },
          timeout: config.timeout,
          ...(config.httpsAgent !== undefined ? { httpsAgent: config.httpsAgent } : {}),
        }),
      );

      return data.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      this.logError('chat/completions', err);
      return null;
    }
  }

  private buildExtractionPrompt(documentContents: string[]): string {
    return `Extrahiere Vertragsdaten aus folgenden Dokumenten:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}\n\nAntworte NUR mit JSON.`;
  }

  private buildSummarizePrompt(documentContents: string[]): string {
    return `Fasse folgende Versicherungsdokumente zusammen:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}`;
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
  ): Promise<AiSummarizeResult | null> {
    void _policyId;

    if (documentContents.length === 0) return null;

    const config = await this.runtimeConfig();
    const raw = await this.chatCompletion(
      SUMMARIZE_SYSTEM_PROMPT,
      this.buildSummarizePrompt(documentContents),
      config,
    );

    if (!raw) return null;

    return {
      summaryMarkdown: raw,
      sourceDocumentRefs: [],
      model: config.model,
    };
  }

  async healthCheck(): Promise<boolean> {
    return (await this.healthStatus()).connected;
  }

  /**
   * Detailed health check (BugFix-22) with a machine-readable reason.
   *
   * `GET /models` is the cheap probe. When a provider does not expose a
   * model list (404/405) the probe falls back to the endpoint the feature
   * actually uses (`POST /chat/completions`, minimal request), because such
   * a provider is perfectly usable and must not be reported as "not
   * answering". The successful fallback is reused for a short time so that
   * it never costs a request per page view.
   */
  async healthStatus(): Promise<AiHealthStatus> {
    const config = await this.runtimeConfig();
    if (!config.configured) return { connected: false, reason: 'not-configured' };
    if (Date.now() < this.healthFallbackValidUntil) return { connected: true, reason: null };

    const models = await this.probe(
      `${config.baseUrl}/models`,
      'GET',
      config,
      undefined,
    );

    if (models.status !== null) {
      if (models.status >= 200 && models.status < 300) {
        return { connected: true, reason: null };
      }
      if (models.status === 401 || models.status === 403) {
        return { connected: false, reason: 'unauthorized' };
      }
      if (models.status === 404 || models.status === 405) {
        return this.probeCompletionFallback(config);
      }
      return { connected: false, reason: 'http-error' };
    }

    return { connected: false, reason: models.reason ?? 'unreachable' };
  }

  /** Fallback probe for providers without a `GET /models` endpoint. */
  private async probeCompletionFallback(config: OpenAiRuntimeConfig): Promise<AiHealthStatus> {
    const completion = await this.probe(
      `${config.baseUrl}/chat/completions`,
      'POST',
      config,
      // Deliberately no `max_tokens`/`temperature`: some models reject
      // them, which would hide that the endpoint itself is healthy.
      { model: config.model, messages: [{ role: 'user', content: 'ping' }] },
    );

    if (completion.status !== null && completion.status >= 200 && completion.status < 300) {
      this.healthFallbackValidUntil = Date.now() + HEALTH_FALLBACK_TTL_MS;
      return { connected: true, reason: null };
    }
    if (completion.status === 401 || completion.status === 403) {
      return { connected: false, reason: 'unauthorized' };
    }
    if (completion.status === null) {
      return { connected: false, reason: completion.reason ?? 'unreachable' };
    }
    return { connected: false, reason: 'http-error' };
  }

  /**
   * Single health request that never throws. `validateStatus: () => true`
   * keeps non-2xx answers as statuses so they can be classified instead of
   * being logged as errors.
   */
  private async probe(
    url: string,
    method: 'GET' | 'POST',
    config: OpenAiRuntimeConfig,
    body?: Record<string, unknown>,
  ): Promise<{ status: number | null; reason: AiHealthReason | null }> {
    try {
      const request =
        method === 'GET'
          ? this.httpService.get(url, this.probeOptions(config))
          : this.httpService.post(url, body, this.probeOptions(config));
      const { status } = await firstValueFrom(request);
      return { status, reason: null };
    } catch (err) {
      return { status: null, reason: classifyAiHealthError(err) };
    }
  }

  private probeOptions(config: OpenAiRuntimeConfig): Record<string, unknown> {
    return {
      headers: {
        ...this.authHeaders(config),
        'Content-Type': 'application/json',
      },
      timeout: HEALTH_TIMEOUT_MS,
      validateStatus: () => true,
      ...(config.httpsAgent !== undefined ? { httpsAgent: config.httpsAgent } : {}),
    };
  }

  private logError(method: string, err: unknown): void {
    if (err instanceof AxiosError) {
      this.logger.warn(
        `OpenAI API ${method} failed: status=${err.response?.status ?? 'no response'}, message=${err.message}`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`OpenAI API ${method} error: ${err.message}`);
    } else {
      this.logger.warn(`OpenAI API ${method} unknown error`);
    }
  }
}
