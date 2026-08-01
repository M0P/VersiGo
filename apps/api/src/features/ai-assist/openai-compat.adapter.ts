import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SettingsResolverService } from '@insura/foundation';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import type { IAIAdapter, AiExtractResult, AiSummarizeResult } from '@insura/foundation';
import { tryParseExtractionResponse } from './ai-json.helper';

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
}

/**
 * OpenAI-kompatibler Adapter (AP-17): liest seine Konfiguration pro Aufruf
 * ueber die zentrale Settings-Aufloesung (UI > .env > Default). Dadurch
 * wirken Admin-UI-Aenderungen an AI_OPENAI_COMPAT_* sofort, ohne Neustart.
 * Der API-Key wird intern entschluesselt geliefert und nie protokolliert.
 */
@Injectable()
export class OpenAiCompatAdapter implements IAIAdapter {
  private readonly logger = new Logger(OpenAiCompatAdapter.name);
  readonly providerKey = 'openai-compat';

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
    const configured = baseUrl.length > 0 && apiKey.length > 0;

    if (configured && baseUrl.startsWith('http://')) {
      this.logger.warn(
        'AI_OPENAI_COMPAT_BASE_URL verwendet HTTP. Der API-Key wird im Klartext ' +
          'uebertragen. Verwende https:// fuer Produktionsumgebungen.',
      );
    }

    return { baseUrl, apiKey, model, timeout, configured };
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
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: config.timeout,
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
      this.logger.warn(`Konnte JSON nicht parsen aus AI-Antwort: ${raw.substring(0, 200)}`);
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
    const config = await this.runtimeConfig();
    if (!config.configured) return false;

    try {
      const url = `${config.baseUrl}/models`;
      const { status } = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 5_000,
        }),
      );
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  private logError(method: string, err: unknown): void {
    if (err instanceof AxiosError) {
      this.logger.warn(
        `OpenAI-API ${method} fehlgeschlagen: status=${err.response?.status ?? 'keine Antwort'}, message=${err.message}`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`OpenAI-API ${method} Fehler: ${err.message}`);
    } else {
      this.logger.warn(`OpenAI-API ${method} unbekannter Fehler`);
    }
  }
}
