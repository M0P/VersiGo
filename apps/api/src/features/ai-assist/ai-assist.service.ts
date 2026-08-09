import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService, SettingsResolverService } from '@versigo/foundation';
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
      throw new ForbiddenException('AI features are disabled');
    }
  }

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: no access to a foreign household');
    }
  }

  /**
   * Starts an asynchronous AI extraction job for a policy.
   */
  async startExtraction(
    householdId: string,
    userId: string,
    policyId: string,
  ): Promise<{ jobId: string; status: string }> {
    await this.assertAiEnabled();
    await this.assertHouseholdAccess(householdId, userId);

    // Check whether the policy exists
    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    // Check whether a running job already exists
    const existingJob = await this.db.aiExtractionJob.findFirst({
      where: { policyId, status: { in: ['PENDING', 'RUNNING'] } },
    });

    if (existingJob) {
      return { jobId: existingJob.id, status: existingJob.status };
    }

    // Collect document IDs that are not excluded from AI processing
    const documents = await this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null, aiProcessingExcluded: false },
      select: { id: true, storageRef: true },
    });

    // Create a new job entry in the database
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

    // Send the job to BullMQ
    await this.extractionQueue.add('extract', {
      jobId: job.id,
      policyId,
      documentIds: documents.map((d) => d.id),
      providerKey: adapter.providerKey,
    });

    this.logger.log(`AI extraction job ${job.id} started for policy ${policyId}`);

    return { jobId: job.id, status: 'PENDING' };
  }

  /**
   * Retrieves the status of an extraction job.
   */
  async getJobStatus(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    jobId: string,
  ) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const job = await this.db.aiExtractionJob.findFirst({
      where: { id: jobId, policyId },
    });

    if (!job) {
      throw new NotFoundException('AI extraction job not found');
    }

    return job;
  }

  /**
   * Lists all extraction jobs of a policy.
   */
  async listJobs(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
  ) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    return this.db.aiExtractionJob.findMany({
      where: { policyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Returns the latest summary of a policy with resolved source document information
   * (document names, provider and model).
   * Throws NotFoundException when no summary exists.
   */
  async getLatestSummaryWithSources(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
  ) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const summary = await this.db.aiCoverageSummary.findFirst({
      where: { policyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!summary) {
      throw new NotFoundException('No summary found');
    }

    // Read sourceDocumentRefs (array of document IDs) and resolve names
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
   * Runs a synchronous extraction (for tests / debugging).
   * In normal operation it runs asynchronously via jobs.
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
      throw new NotFoundException('Policy not found');
    }

    const adapter: IAIAdapter = await this.providerRegistry.getAdapter();

    // Load document contents (currently only storage refs; the actual content
    // may need to be loaded from a file - placeholder here)
    const documents = await this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null, aiProcessingExcluded: false },
    });

    // Since we currently have no full-text extraction from files,
    // we simulate the document contents with metadata
    const documentContents = documents.map(
      (doc) => `Datei: ${doc.fileName} (${doc.mimeType ?? 'unbekannt'})`,
    );

    const result = await adapter.extractContractFacts(documentContents, policyId);
    if (!result) return null;

    // Store the result in the latest job or create a new one
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
   * Creates a summary of the insurance coverage.
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
      throw new NotFoundException('Policy not found');
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

    // Store the summary (append-only, but old entries
    // are limited: at most 5 summaries per policy)
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

      // Remove surplus old summaries, keep only the 5 newest
      const summaries = await tx.aiCoverageSummary.findMany({
        where: { policyId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        skip: 5, // keep the 5 newest
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
   * Marks a document as "excluded from AI processing".
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
      throw new NotFoundException('Document not found');
    }

    await this.db.policyDocument.update({
      where: { id: documentId },
      data: { aiProcessingExcluded: excluded },
    });

    return { success: true };
  }

  /**
   * Checks the connection to the AI provider.
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
