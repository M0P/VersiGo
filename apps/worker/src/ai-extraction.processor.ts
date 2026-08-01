import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DatabaseService, SettingsResolverService } from '@insura/foundation';
import type { IAIAdapter, AiExtractResult, AiSummarizeResult } from '@insura/foundation';
import type { Prisma } from '@prisma/client';
import axios, { AxiosError } from 'axios';

interface AiExtractionJobData {
  jobId: string;
  policyId: string;
  documentIds: string[];
  providerKey: string;
}

/**
 * Extrahiert JSON aus einer AI-Antwort und trennt Felder von Konfidenzwerten.
 * Gemeinsame Hilfsfunktion fuer Worker-Adapter.
 */
function tryParseExtractionResponse(
  raw: string,
  model: string,
): { fields: Record<string, unknown>; confidence: Record<string, number>; model: string } | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : raw;

  try {
    const parsed = JSON.parse(jsonStr);
    const fields: Record<string, unknown> = {};
    const confidence: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'confidence' && typeof value === 'object' && value !== null) {
        for (const [ck, cv] of Object.entries(value as Record<string, unknown>)) {
          confidence[ck] = typeof cv === 'number' ? cv : 0;
        }
      } else if (!key.startsWith('confidence')) {
        fields[key] = value;
      }
    }

    const hasConfidenceKey = Object.keys(parsed).some((k) => k === 'confidence');
    if (!hasConfidenceKey) {
      for (const key of Object.keys(fields)) {
        confidence[key] = 0.8;
      }
    }

    return { fields, confidence, model };
  } catch {
    return null;
  }
}

/**
 * Bereitet ein Objekt fuer Prisma-JSON-Felder vor (Deep-Clone via Serialisierung).
 */
function toPrismaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// --- Simple AI adapter implementations for the worker ---
// These are self-contained versions that don't depend on NestJS DI.

class WorkerNoOpAdapter implements IAIAdapter {
  readonly providerKey = 'none';
  async extractContractFacts(): Promise<AiExtractResult | null> { return null; }
  async summarizeCoverage(): Promise<AiSummarizeResult | null> { return null; }
  async healthCheck(): Promise<boolean> { return false; }
}

class WorkerOllamaAdapter implements IAIAdapter {
  readonly providerKey = 'ollama';
  private readonly logger = new Logger(WorkerOllamaAdapter.name);

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeout: number,
  ) {}

  async extractContractFacts(
    documentContents: string[],
    _policyId: string,
  ): Promise<AiExtractResult | null> {
    if (documentContents.length === 0) return null;

    const systemPrompt = `Du extrahierst Versicherungsvertragsdaten aus Dokumenten.
Antworte NUR mit einem gueltigen JSON-Objekt.
Jedes Feld muss einen confidence-Wert zwischen 0 und 1 haben.
Antworte NUR mit JSON, keinem anderen Text.`;

    const userPrompt = `Extrahiere Vertragsdaten aus folgenden Dokumenten:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}\n\nAntworte NUR mit JSON.`;

    return this.chatCompletion(systemPrompt, userPrompt);
  }

  async summarizeCoverage(
    documentContents: string[],
    _policyId: string,
  ): Promise<AiSummarizeResult | null> {
    if (documentContents.length === 0) return null;

    const systemPrompt = `Du fasst Versicherungsvertraege zusammen.
Erstelle eine praegnante Zusammenfassung in deutscher Sprache im Markdown-Format.`;

    const userPrompt = `Fasse folgende Versicherungsdokumente zusammen:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}`;

    const raw = await this.chatCompletionRaw(systemPrompt, userPrompt);
    if (!raw) return null;

    return {
      summaryMarkdown: raw,
      sourceDocumentRefs: [],
      model: this.model,
    };
  }

  private async chatCompletionRaw(
    systemPrompt: string,
    userContent: string,
  ): Promise<string | null> {
    try {
      const { data } = await axios.post(
        `${this.baseUrl}/api/chat`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          stream: false,
        },
        { timeout: this.timeout },
      );
      return data.message?.content ?? null;
    } catch (err) {
      this.logError('chat', err);
      return null;
    }
  }

  private async chatCompletion(
    systemPrompt: string,
    userContent: string,
  ): Promise<AiExtractResult | null> {
    const raw = await this.chatCompletionRaw(systemPrompt, userContent);
    if (!raw) return null;

    const parsed = tryParseExtractionResponse(raw, this.model);
    if (!parsed) {
      this.logger.warn(`Konnte JSON nicht parsen aus AI-Antwort: ${raw.substring(0, 200)}`);
      return null;
    }
    return parsed;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { status } = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5_000 });
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

class WorkerOpenAiCompatAdapter implements IAIAdapter {
  readonly providerKey = 'openai-compat';
  private readonly logger = new Logger(WorkerOpenAiCompatAdapter.name);

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeout: number,
    private readonly enabled: boolean,
  ) {}

  private isConfigured(): boolean {
    return this.enabled && this.baseUrl.length > 0 && this.apiKey.length > 0;
  }

  async extractContractFacts(
    documentContents: string[],
    _policyId: string,
  ): Promise<AiExtractResult | null> {
    if (!this.isConfigured() || documentContents.length === 0) return null;

    const systemPrompt = `Du extrahierst Versicherungsvertragsdaten aus Dokumenten.
Antworte NUR mit einem gueltigen JSON-Objekt.
Jedes Feld muss einen confidence-Wert zwischen 0 und 1 haben.
Antworte NUR mit JSON, keinem anderen Text.`;

    const userPrompt = `Extrahiere Vertragsdaten aus folgenden Dokumenten:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}\n\nAntworte NUR mit JSON.`;

    return this.chatCompletion(systemPrompt, userPrompt);
  }

  async summarizeCoverage(
    documentContents: string[],
    _policyId: string,
  ): Promise<AiSummarizeResult | null> {
    if (!this.isConfigured() || documentContents.length === 0) return null;

    const systemPrompt = `Du fasst Versicherungsvertraege zusammen.
Erstelle eine praegnante Zusammenfassung in deutscher Sprache im Markdown-Format.`;

    const userPrompt = `Fasse folgende Versicherungsdokumente zusammen:\n\n${documentContents
      .map((content, i) => `--- Dokument ${i + 1} ---\n${content}`)
      .join('\n\n')}`;

    const raw = await this.chatCompletionRaw(systemPrompt, userPrompt);
    if (!raw) return null;

    return {
      summaryMarkdown: raw,
      sourceDocumentRefs: [],
      model: this.model,
    };
  }

  private async chatCompletionRaw(
    systemPrompt: string,
    userContent: string,
  ): Promise<string | null> {
    try {
      const { data } = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: 2000,
          temperature: 0.1,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        },
      );
      return data.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      this.logError('chat/completions', err);
      return null;
    }
  }

  private async chatCompletion(
    systemPrompt: string,
    userContent: string,
  ): Promise<AiExtractResult | null> {
    const raw = await this.chatCompletionRaw(systemPrompt, userContent);
    if (!raw) return null;

    const parsed = tryParseExtractionResponse(raw, this.model);
    if (!parsed) {
      this.logger.warn(`Konnte JSON nicht parsen aus AI-Antwort: ${raw.substring(0, 200)}`);
      return null;
    }
    return parsed;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const { status } = await axios.get(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 5_000,
      });
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

// --- Processor ---

@Processor('ai-extraction', {
  concurrency: 2,
})
export class AiExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(AiExtractionProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsResolverService,
  ) {
    super();
  }

  /**
   * Loest den aktiven Adapter pro Job ueber die zentrale Settings-Aufloesung
   * auf (AP-17: UI > .env > Default). Admin-UI-Aenderungen an AI_ENABLED,
   * AI_PROVIDER, Modellen, Endpunkten und Timeouts wirken damit auch im
   * Worker ohne Neustart.
   */
  private async resolveAdapter(): Promise<IAIAdapter> {
    const enabled = await this.settings.getEffectiveBoolean('AI_ENABLED');
    if (!enabled) {
      return new WorkerNoOpAdapter();
    }

    const provider = (await this.settings.getEffectiveString('AI_PROVIDER')) ?? 'ollama';
    const timeout =
      (await this.settings.getEffectiveNumber('AI_EXTRACTION_TIMEOUT_MS')) ?? 60000;

    switch (provider) {
      case 'openai-compat': {
        const baseUrl = (
          (await this.settings.getEffectiveString('AI_OPENAI_COMPAT_BASE_URL')) ?? ''
        ).replace(/\/+$/, '');
        const apiKey = (await this.settings.getEffectiveString('AI_OPENAI_COMPAT_API_KEY')) ?? '';
        const model =
          (await this.settings.getEffectiveString('AI_OPENAI_COMPAT_MODEL')) ?? 'gpt-4o-mini';
        return new WorkerOpenAiCompatAdapter(
          baseUrl,
          apiKey,
          model,
          timeout,
          baseUrl.length > 0 && apiKey.length > 0,
        );
      }
      case 'ollama':
      default: {
        const baseUrl = (
          (await this.settings.getEffectiveString('AI_OLLAMA_BASE_URL')) ?? 'http://localhost:11434'
        ).replace(/\/+$/, '');
        const model = (await this.settings.getEffectiveString('AI_OLLAMA_MODEL')) ?? 'llama3';
        return new WorkerOllamaAdapter(baseUrl, model, timeout);
      }
    }
  }

  async process(job: Job<AiExtractionJobData>): Promise<{ success: boolean; error?: string }> {
    const { jobId, policyId, documentIds } = job.data;

    this.logger.log(`Verarbeite AI-Extraktions-Job ${jobId} fuer Policy ${policyId}`);

    try {
      const adapter = await this.resolveAdapter();
      await this.db.aiExtractionJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING' },
      });

      const documents = await this.db.policyDocument.findMany({
        where: { id: { in: documentIds }, archivedAt: null, aiProcessingExcluded: false },
      });

      const documentContents = documents.map(
        (doc) => `Datei: ${doc.fileName} (${doc.mimeType ?? 'unbekannt'})`,
      );

      if (documentContents.length === 0) {
        await this.db.aiExtractionJob.update({
          where: { id: jobId },
          data: {
            status: 'SKIPPED',
            completedAt: new Date(),
            errorMessage: 'Keine Dokumente fuer AI-Extraktion verfuegbar',
          },
        });
        return { success: true };
      }

      const result = await adapter.extractContractFacts(documentContents, policyId);

      if (!result) {
        const currentJob = await this.db.aiExtractionJob.findUnique({ where: { id: jobId } });
        const retryCount = (currentJob?.retryCount ?? 0) + 1;

        if (retryCount <= (currentJob?.maxRetries ?? 3)) {
          this.logger.warn(
            `AI-Extraktion fehlgeschlagen fuer Job ${jobId}, ` +
              `versuche erneut (${retryCount}/${currentJob?.maxRetries ?? 3})`,
          );

          await this.db.aiExtractionJob.update({
            where: { id: jobId },
            data: { status: 'PENDING', retryCount, errorMessage: 'Extraktion fehlgeschlagen, Wiederholung geplant' },
          });

          throw new Error('AI-Extraktion fehlgeschlagen, Retry erforderlich');
        }

        await this.db.aiExtractionJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: 'AI-Extraktion nach mehreren Versuchen fehlgeschlagen',
          },
        });

        return { success: false, error: 'Maximale Anzahl an Wiederholungen erreicht' };
      }

      await this.db.aiExtractionJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          extractedFieldsJson: toPrismaJson(result.fields) as Prisma.InputJsonValue,
          confidenceJson: toPrismaJson(result.confidence) as Prisma.InputJsonValue,
          model: result.model,
          completedAt: new Date(),
        },
      });

      this.logger.log(`AI-Extraktions-Job ${jobId} erfolgreich abgeschlossen`);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      this.logger.error(`AI-Extraktions-Job ${jobId} fehlgeschlagen: ${message}`);

      // Nur auf FAILED setzen, wenn es kein Retry ist
      const currentJob = await this.db.aiExtractionJob.findUnique({ where: { id: jobId } });
      if (currentJob && currentJob.status !== 'PENDING') {
        await this.db.aiExtractionJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
        });
      }

      return { success: false, error: message };
    }
  }
}
