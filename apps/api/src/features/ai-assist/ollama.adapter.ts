import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SettingsResolverService } from '@versigo/foundation';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import type { IAIAdapter, AiExtractResult, AiSummarizeResult } from '@versigo/foundation';
import { tryParseExtractionResponse } from './ai-json.helper';
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

const SUMMARIZE_SYSTEM_PROMPT = `Du fasst Versicherungsvertraege zusammen.
Erstelle eine praegnante Zusammenfassung in deutscher Sprache im Markdown-Format.
Wenn vorhanden, gib Deckungssummen, Ausschluesse, Selbstbehalte und Kuendigungsfristen an.
Halte die Zusammenfassung auf max. 500 Zeichen.`;

interface OllamaRuntimeConfig {
  baseUrl: string;
  model: string;
  timeout: number;
  /** BugFix-06: HTTPS-Agent mit deaktivierter Zertifikatsvalidierung (opt-in). */
  httpsAgent?: import('https').Agent;
}

/**
 * Ollama-Adapter (AP-17): liest seine Konfiguration pro Aufruf ueber die
 * zentrale Settings-Aufloesung (UI > .env > Default). Dadurch wirken
 * Admin-UI-Aenderungen an AI_OLLAMA_BASE_URL/-MODEL/-TIMEOUT sofort,
 * ohne Neustart.
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
    try {
      const config = await this.runtimeConfig();
      const url = `${config.baseUrl}/api/tags`;
      const { status } = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 5_000,
          ...(config.httpsAgent !== undefined ? { httpsAgent: config.httpsAgent } : {}),
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
        `Ollama-API ${method} fehlgeschlagen: status=${err.response?.status ?? 'keine Antwort'}, message=${err.message}`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`Ollama-API ${method} Fehler: ${err.message}`);
    } else {
      this.logger.warn(`Ollama-API ${method} unbekannter Fehler`);
    }
  }
}
