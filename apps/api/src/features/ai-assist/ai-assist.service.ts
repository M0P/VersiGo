import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService, SettingsResolverService } from '@insura/foundation';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { AiProviderRegistry } from './ai-provider-registry';
import { AI_EXTRACTION_QUEUE } from './ai-assist.constants';
import { toPrismaJson } from './ai-json.helper';
import type { IAIAdapter } from './ai-assist.interface';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';

@Injectable()
export class AiAssistService {
  private readonly logger = new Logger(AiAssistService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly settings: SettingsResolverService,
    private readonly authService: AuthService,
    @InjectQueue(AI_EXTRACTION_QUEUE) private readonly extractionQueue: Queue,
  ) {}

  private async assertAiEnabled(): Promise<void> {
    const enabled = await this.settings.getEffectiveBoolean('AI_ENABLED');
    if (!enabled) {
      throw new ForbiddenException('AI-Funktionen sind deaktiviert');
    }
  }

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }
  }

  /**
   * Startet einen asynchronen AI-Extraktions-Job fuer eine Policy.
   */
  async startExtraction(
    householdId: string,
    userId: string,
    policyId: string,
  ): Promise<{ jobId: string; status: string }> {
    await this.assertAiEnabled();
    await this.assertHouseholdAccess(householdId, userId);

    // Pruefe, ob die Policy existiert
    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    // Pruefe, ob bereits ein laufender Job existiert
    const existingJob = await this.db.aiExtractionJob.findFirst({
      where: { policyId, status: { in: ['PENDING', 'RUNNING'] } },
    });

    if (existingJob) {
      return { jobId: existingJob.id, status: existingJob.status };
    }

    // Sammle Dokument-IDs, die nicht von AI-Verarbeitung ausgeschlossen sind
    const documents = await this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null, aiProcessingExcluded: false },
      select: { id: true, storageRef: true },
    });

    // Erstelle einen neuen Job-Eintrag in der Datenbank
    const adapter = await this.providerRegistry.getAdapter();
    const job = await this.db.aiExtractionJob.create({
      data: {
        policyId,
        providerKey: adapter.providerKey,
        model: null,
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
        inputDocumentRef: JSON.stringify(documents.map((d) => d.id)),
      },
    });

    // Sende den Job an BullMQ
    await this.extractionQueue.add('extract', {
      jobId: job.id,
      policyId,
      documentIds: documents.map((d) => d.id),
      providerKey: adapter.providerKey,
    });

    this.logger.log(`AI-Extraktions-Job ${job.id} fuer Policy ${policyId} gestartet`);

    return { jobId: job.id, status: 'PENDING' };
  }

  /**
   * Ruft den Status eines Extraktions-Jobs ab.
   */
  async getJobStatus(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    jobId: string,
  ) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const job = await this.db.aiExtractionJob.findFirst({
      where: { id: jobId, policyId },
    });

    if (!job) {
      throw new NotFoundException('AI-Extraktions-Job nicht gefunden');
    }

    return job;
  }

  /**
   * Listet alle Extraktions-Jobs einer Policy auf.
   */
  async listJobs(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
  ) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    return this.db.aiExtractionJob.findMany({
      where: { policyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Ruft die letzte Zusammenfassung einer Policy mit aufgeloesten Quelldokument-Informationen ab.
   * Gibt die Zusammenfassung mit Dokumentnamen, Provider und Modell zurueck.
   * Wirft NotFoundException, wenn keine Zusammenfassung existiert.
   */
  async getLatestSummaryWithSources(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
  ) {
    // Wirft 403/404 je nach Rolle und Freigabe (READ_ONLY nur bei Share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const summary = await this.db.aiCoverageSummary.findFirst({
      where: { policyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!summary) {
      throw new NotFoundException('Keine Zusammenfassung gefunden');
    }

    // Lese sourceDocumentRefs (Array von Dokument-IDs) und loese Namen auf
    const sourceDocIds: string[] = Array.isArray(summary.sourceDocumentRefsJson)
      ? (summary.sourceDocumentRefsJson as string[])
      : [];

    const documents = sourceDocIds.length > 0
      ? await this.db.policyDocument.findMany({
          where: { id: { in: sourceDocIds } },
          select: { id: true, fileName: true },
        })
      : [];

    const sourceDocuments = documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
    }));

    return {
      id: summary.id,
      policyId: summary.policyId,
      providerKey: summary.providerKey,
      model: summary.model,
      summaryMarkdown: summary.summaryMarkdown,
      sourceDocuments,
      createdAt: summary.createdAt,
    };
  }

  /**
   * Fuehrt eine synchrone Extraktion durch (fuer Tests / Debug).
   * Im Normalbetrieb asynchron ueber Jobs.
   */
  async extractNow(
    householdId: string,
    userId: string,
    policyId: string,
  ): Promise<Record<string, unknown> | null> {
    await this.assertAiEnabled();
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const adapter: IAIAdapter = await this.providerRegistry.getAdapter();

    // Lade Dokument-Inhalte (aktuell nur Storage-Refs, da tatsaechlicher Inhalt
    // ggf. aus einer Datei geladen werden muss - hier als Platzhalter)
    const documents = await this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null, aiProcessingExcluded: false },
    });

    // Da wir aktuell keine Volltext-Extraktion aus Dateien haben,
    // simulieren wir die Dokumentinhalte mit Metadaten
    const documentContents = documents.map(
      (doc) => `Datei: ${doc.fileName} (${doc.mimeType ?? 'unbekannt'})`,
    );

    const result = await adapter.extractContractFacts(documentContents, policyId);
    if (!result) return null;

    // Speichere das Ergebnis im neuesten Job oder erstelle einen neuen
    await this.db.aiExtractionJob.create({
      data: {
        policyId,
        providerKey: adapter.providerKey,
        model: result.model,
        status: 'COMPLETED',
        extractedFieldsJson: toPrismaJson(result.fields) as Prisma.InputJsonValue,
        confidenceJson: toPrismaJson(result.confidence) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return {
      fields: result.fields,
      confidence: result.confidence,
      model: result.model,
    };
  }

  /**
   * Erstellt eine Zusammenfassung des Versicherungsschutzes.
   */
  async summarize(
    householdId: string,
    userId: string,
    policyId: string,
  ): Promise<Record<string, unknown> | null> {
    await this.assertAiEnabled();
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    const adapter: IAIAdapter = await this.providerRegistry.getAdapter();

    const documents = await this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null, aiProcessingExcluded: false },
    });

    const documentContents = documents.map(
      (doc) => `Datei: ${doc.fileName} (${doc.mimeType ?? 'unbekannt'})`,
    );

    const result = await adapter.summarizeCoverage(documentContents, policyId);
    if (!result) return null;

    // Speichere die Zusammenfassung (append-only, aber alte Eintraege
    // werden begrenzt: maximal 5 Zusammenfassungen pro Policy)
    await this.db.$transaction(async (tx) => {
      await tx.aiCoverageSummary.create({
        data: {
          policyId,
          providerKey: adapter.providerKey,
          model: result.model,
          summaryMarkdown: result.summaryMarkdown,
          sourceDocumentRefsJson: result.sourceDocumentRefs,
        },
      });

      // Entferne ueberzaehlige alte Zusammenfassungen, behalte nur die 5 neuesten
      const summaries = await tx.aiCoverageSummary.findMany({
        where: { policyId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        skip: 5, // die 5 neuesten behalten
      });
      if (summaries.length > 0) {
        await tx.aiCoverageSummary.deleteMany({
          where: { id: { in: summaries.map((s) => s.id) } },
        });
      }
    });

    return {
      summaryMarkdown: result.summaryMarkdown,
      model: result.model,
    };
  }

  /**
   * Markiert ein Dokument als "von AI-Verarbeitung ausgeschlossen".
   */
  async setDocumentExclusion(
    householdId: string,
    userId: string,
    policyId: string,
    documentId: string,
    excluded: boolean,
  ): Promise<{ success: boolean }> {
    await this.assertHouseholdAccess(householdId, userId);

    const document = await this.db.policyDocument.findFirst({
      where: { id: documentId, policyId },
    });

    if (!document) {
      throw new NotFoundException('Dokument nicht gefunden');
    }

    await this.db.policyDocument.update({
      where: { id: documentId },
      data: { aiProcessingExcluded: excluded },
    });

    return { success: true };
  }

  /**
   * Prueft die Verbindung zum AI-Provider.
   */
  async healthCheck(): Promise<{ connected: boolean; provider: string }> {
    const enabled = await this.settings.getEffectiveBoolean('AI_ENABLED');
    if (!enabled) {
      return { connected: false, provider: 'none' };
    }

    const adapter = await this.providerRegistry.getAdapter();
    const connected = await adapter.healthCheck();

    return { connected, provider: adapter.providerKey };
  }
}
