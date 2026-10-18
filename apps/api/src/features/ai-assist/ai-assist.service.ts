import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DatabaseService,
  SettingsResolverService,
  buildCoverageSummaryRepairHint,
  costExtractionRepairHint,
  coverageSummaryToPlainText,
  validateCostExtraction,
  validateCoverageSummary,
  type AiHealthReason,
  type AiHealthStatus,
  type CoverageSummaryDocument,
  type CostExtractionSuggestion,
} from '@versigo/foundation';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { AiProviderRegistry } from './ai-provider-registry';
import {
  AI_COST_EXTRACTION_MAX_CHARS,
  AI_EXTRACTION_QUEUE,
  AI_SUMMARY_MAX_CHARS,
  AI_SUMMARY_MAX_DOCUMENTS,
} from './ai-assist.constants';
import { toPrismaJson } from './ai-json.helper';
import type { IAIAdapter } from './ai-assist.interface';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';

/**
 * AP-24 (§4.2): response of the cost-extraction endpoint.
 *
 * `suggestion` is validated against the versioned schema; `existingEntries`
 * exist only as a duplicate warning. Nothing here is stored yet.
 */
export interface CostExtractionSuggestionResponse {
  document: {
    id: string;
    fileName: string;
    mimeType: string | null;
    documentDate: Date | null;
  };
  suggestion: CostExtractionSuggestion;
  existingEntries: {
    id: string;
    validFrom: Date;
    validTo: Date | null;
    grossAmount: Prisma.Decimal | null;
    netAmount: Prisma.Decimal | null;
    frequency: string;
  }[];
  model: string;
  providerKey: string;
}

/**
 * Result of the AI health endpoint (BugFix-22).
 * `reason` is `null` while connected; otherwise it is a coarse,
 * secret-free code that the UI translates into a human hint.
 */
export interface AiHealthCheckResult {
  connected: boolean;
  provider: string;
  reason: AiHealthReason | null;
  /**
   * AP-24 (§3.1/§4.2): single capability flag for the interface. AI-based
   * options (coverage summary, cost extraction) are only offered when this is
   * true – and the API enforces the same condition on every request, because
   * the UI is not a security boundary.
   */
  capable: boolean;
}

/**
 * AP-24 (§3.1): why a document is not sent to the provider. The reasons are
 * reported to the user instead of silently dropping the document.
 */
export type SummarizeSkippedReason = 'EXCLUDED_FROM_AI' | 'EMPTY_FILE_NAME' | 'UNSUPPORTED_TYPE';

export interface SummarizeSkippedDocument {
  id: string;
  fileName: string;
  reason: SummarizeSkippedReason;
}

/**
 * AP-24 (§3.1): optional narrowing of the summary's inputs.
 * Without `documentIds` the historic behaviour (all non-excluded documents of
 * the policy) is kept.
 */
export interface SummarizeOptions {
  /** Only these documents are used; must be CONTRACT documents of the policy. */
  documentIds?: string[];
  /**
   * `true` after the user explicitly confirmed that unusable documents are
   * left out (the API answers `UNUSABLE_DOCUMENTS` first).
   */
  acceptPartial?: boolean;
}

const SUMMARY_MIME_PREFIXES = ['text/', 'image/', 'application/pdf'];
const SUMMARY_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/octet-stream',
];

/**
 * AP-24 (§3.1): decides whether a document can be read at all.
 *
 * A missing MIME type is *not* a rejection: Paperless links frequently carry
 * none, and rejecting them would change long-standing behaviour for the
 * worst reason.
 */
function isSupportedSummaryType(mimeType: string | null): boolean {
  if (!mimeType) return true;
  const value = mimeType.toLowerCase().split(';')[0].trim();
  if (SUMMARY_MIME_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  return SUMMARY_MIME_TYPES.includes(value);
}

/**
 * AP-24 (§3.2): re-validates a stored summary document. Rows written before
 * AP-24 (or by a newer version) are never trusted blindly – an unreadable
 * document degrades to the legacy Markdown rendering instead of breaking the
 * whole section.
 */
function readStoredSummary(value: Prisma.JsonValue): CoverageSummaryDocument | null {
  const result = validateCoverageSummary(JSON.stringify(value));
  return result.ok ? result.value : null;
}

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

    // AP-24 (§3.2): new summaries carry the validated structure; anything
    // older (or unreadable) stays a legacy Markdown summary.
    const parsed = summary.summaryJson === null ? null : readStoredSummary(summary.summaryJson);

    return {
      id: summary.id,
      policyId: summary.policyId,
      providerKey: summary.providerKey,
      model: summary.model,
      format: parsed ? ('json' as const) : ('markdown' as const),
      summary: parsed,
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
   * AP-24 (§3.1): resolves the documents that may be handed to the provider.
   *
   * Two callers exist:
   * - with `documentIds` (the picker in the policy view) only CONTRACT
   *   documents of the policy that the user may read are accepted; anything
   *   else is a hard error instead of a silently different summary,
   * - without `documentIds` the historic behaviour is kept (all non-excluded
   *   documents of the policy).
   *
   * Unusable documents are never dropped silently: they are reported as
   * `skipped` and, unless the user already confirmed it, the request is
   * refused.
   */
  private async selectSummaryDocuments(
    policyId: string,
    options?: SummarizeOptions,
  ): Promise<{
    documents: { id: string; fileName: string; mimeType: string | null }[];
    skipped: SummarizeSkippedDocument[];
  }> {
    const explicit = options?.documentIds;

    let candidates: {
      id: string;
      fileName: string;
      mimeType: string | null;
      aiProcessingExcluded: boolean;
    }[];

    if (explicit && explicit.length > 0) {
      const unique = [...new Set(explicit)];
      if (unique.length > AI_SUMMARY_MAX_DOCUMENTS) {
        throw new BadRequestException({
          code: 'TOO_MANY_DOCUMENTS',
          maxDocuments: AI_SUMMARY_MAX_DOCUMENTS,
          message: `At most ${AI_SUMMARY_MAX_DOCUMENTS} documents can be summarized at once`,
        });
      }

      const found = await this.db.policyDocument.findMany({
        where: {
          id: { in: unique },
          policyId,
          archivedAt: null,
          documentClass: 'CONTRACT',
        },
        select: { id: true, fileName: true, mimeType: true, aiProcessingExcluded: true },
      });

      const foundIds = new Set(found.map((doc) => doc.id));
      const invalidDocumentIds = unique.filter((id) => !foundIds.has(id));
      if (invalidDocumentIds.length > 0) {
        throw new BadRequestException({
          code: 'INVALID_DOCUMENT_SELECTION',
          invalidDocumentIds,
          message: 'Only CONTRACT documents of this policy can be used',
        });
      }

      candidates = found;
    } else {
      candidates = await this.db.policyDocument.findMany({
        where: { policyId, archivedAt: null, aiProcessingExcluded: false },
        select: { id: true, fileName: true, mimeType: true, aiProcessingExcluded: true },
      });

      if (candidates.length > AI_SUMMARY_MAX_DOCUMENTS) {
        throw new BadRequestException({
          code: 'TOO_MANY_DOCUMENTS',
          maxDocuments: AI_SUMMARY_MAX_DOCUMENTS,
          documentCount: candidates.length,
          message: `At most ${AI_SUMMARY_MAX_DOCUMENTS} documents can be summarized at once`,
        });
      }
    }

    // A policy without any document keeps the historic "no summary" answer
    // (the adapter reports that as null) instead of turning it into an error.
    if (candidates.length === 0) return { documents: [], skipped: [] };

    const documents: { id: string; fileName: string; mimeType: string | null }[] = [];
    const skipped: SummarizeSkippedDocument[] = [];

    for (const doc of candidates) {
      if (doc.aiProcessingExcluded) {
        skipped.push({ id: doc.id, fileName: doc.fileName, reason: 'EXCLUDED_FROM_AI' });
      } else if (doc.fileName.trim() === '') {
        skipped.push({ id: doc.id, fileName: doc.fileName, reason: 'EMPTY_FILE_NAME' });
      } else if (!isSupportedSummaryType(doc.mimeType)) {
        skipped.push({ id: doc.id, fileName: doc.fileName, reason: 'UNSUPPORTED_TYPE' });
      } else {
        documents.push({ id: doc.id, fileName: doc.fileName, mimeType: doc.mimeType });
      }
    }

    if (documents.length === 0) {
      throw new BadRequestException({
        code: 'NO_USABLE_DOCUMENTS',
        skippedDocuments: skipped,
        message: 'None of the selected documents can be read',
      });
    }

    if (skipped.length > 0 && options?.acceptPartial !== true) {
      throw new BadRequestException({
        code: 'UNUSABLE_DOCUMENTS',
        skippedDocuments: skipped,
        message: 'Some selected documents cannot be read',
      });
    }

    return { documents, skipped };
  }

  /**
   * Creates a summary of the insurance coverage.
   *
   * AP-24 (§3.2): the answer must be the JSON document of
   * `coverage-summary-format`. A single retry with a precise repair hint is
   * attempted; a second violation becomes a clean error instead of storing
   * an unusable summary.
   */
  async summarize(
    householdId: string,
    userId: string,
    policyId: string,
    options?: SummarizeOptions,
  ): Promise<Record<string, unknown> | null> {
    await this.assertAiEnabled();
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    const selection = await this.selectSummaryDocuments(policyId, options);

    const adapter: IAIAdapter = await this.providerRegistry.getAdapter();

    const documentContents = selection.documents.map(
      (doc) => `Datei: ${doc.fileName} (${doc.mimeType ?? 'unbekannt'})`,
    );

    // AP-24 (§3.1): the size bound is checked before anything leaves the
    // instance. It is reported, never resolved by quietly cutting content.
    const payloadChars = documentContents.join('\n').length;
    if (payloadChars > AI_SUMMARY_MAX_CHARS) {
      throw new BadRequestException({
        code: 'DOCUMENT_PAYLOAD_TOO_LARGE',
        payloadChars,
        maxChars: AI_SUMMARY_MAX_CHARS,
        message: 'The selected documents are too large for an AI summary',
      });
    }

    const first = await adapter.summarizeCoverage(documentContents, policyId);
    if (!first) return null;

    let answer = first;
    let validation = validateCoverageSummary(first.summaryMarkdown);

    if (!validation.ok) {
      const retry = await adapter.summarizeCoverage(documentContents, policyId, {
        repairHint: buildCoverageSummaryRepairHint(validation.error),
      });
      if (!retry) return null;

      answer = retry;
      validation = validateCoverageSummary(retry.summaryMarkdown);

      if (!validation.ok) {
        // The reason is our own validation message – it never contains
        // document content, and it is logged without it as well.
        this.logger.warn(
          `AI provider '${adapter.providerKey}' returned an off-schema summary twice: ${validation.error}`,
        );
        throw new ServiceUnavailableException('AI_SUMMARY_INVALID_FORMAT');
      }
    }

    const summary = validation.value;
    const summaryMarkdown = coverageSummaryToPlainText(summary);
    const usedDocumentIds = selection.documents.map((doc) => doc.id);

    // Store the summary (append-only, but old entries
    // are limited: at most 5 summaries per policy)
    await this.db.$transaction(async (tx) => {
      await tx.aiCoverageSummary.create({
        data: {
          policyId,
          providerKey: adapter.providerKey,
          model: answer.model,
          summaryMarkdown,
          summaryJson: summary as unknown as Prisma.InputJsonValue,
          sourceDocumentRefsJson: usedDocumentIds,
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
      format: 'json',
      summary: summary as unknown as Record<string, unknown>,
      summaryMarkdown,
      model: answer.model,
      // AP-24 (§3.1): the answer names the documents it is based on …
      sourceDocuments: selection.documents.map((doc) => ({ id: doc.id, fileName: doc.fileName })),
      // ... and the ones the user should know about.
      skippedDocuments: selection.skipped,
    };
  }

  /**
   * AP-24 (§4.2): proposes cost data for a single billing document.
   *
   * The proposal is never stored – the user confirms it through the regular
   * cost endpoint (which is also where the document reference is persisted).
   * Everything the model answers is validated against the versioned schema;
   * an off-schema answer is retried exactly once with a precise repair hint
   * and then reported as a clean error, so the user falls back to manual
   * entry instead of reviewing half-invented numbers.
   */
  async extractCostSuggestion(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    documentId: string,
  ): Promise<CostExtractionSuggestionResponse> {
    await this.assertAiEnabled();
    // Throws 403/404 depending on role and share (READ_ONLY only with share).
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const document = await this.db.policyDocument.findFirst({
      where: { id: documentId, policyId, archivedAt: null, documentClass: 'BILLING' },
      select: { id: true, fileName: true, mimeType: true, documentDate: true, aiProcessingExcluded: true },
    });

    if (!document) {
      throw new NotFoundException('No billing document of this policy with this id');
    }

    if (document.aiProcessingExcluded) {
      throw new BadRequestException({
        code: 'DOCUMENT_EXCLUDED_FROM_AI',
        message: 'This document is excluded from AI processing',
      });
    }

    const adapter: IAIAdapter = await this.providerRegistry.getAdapter();
    const extractCost = adapter.extractCostFromDocument?.bind(adapter);
    if (!extractCost) {
      // A resolved adapter without this method means the deployment cannot
      // offer the feature at all – say so instead of returning an empty
      // proposal that looks like "the document had no numbers".
      throw new ServiceUnavailableException('AI_COST_EXTRACTION_UNSUPPORTED');
    }

    // Existing behaviour of the AI feature: documents are represented by
    // their metadata until a full-text extraction exists. Passwords, storage
    // references and file content never leave the instance.
    const documentContent = `Datei: ${document.fileName} (${document.mimeType ?? 'unbekannt'})`;

    if (documentContent.length > AI_COST_EXTRACTION_MAX_CHARS) {
      throw new BadRequestException({
        code: 'DOCUMENT_PAYLOAD_TOO_LARGE',
        payloadChars: documentContent.length,
        maxChars: AI_COST_EXTRACTION_MAX_CHARS,
        message: 'The document is too large for an AI cost extraction',
      });
    }

    const first = await extractCost.call(adapter, documentContent, policyId);
    if (!first) {
      throw new ServiceUnavailableException('AI_COST_EXTRACTION_FAILED');
    }

    let answer = first;
    let validation = validateCostExtraction(first.costJson);
    if (!validation.ok) {
      const retry = await extractCost.call(adapter, documentContent, policyId, {
        repairHint: costExtractionRepairHint(validation.error),
      });
      if (!retry) {
        throw new ServiceUnavailableException('AI_COST_EXTRACTION_FAILED');
      }
      answer = retry;
      validation = validateCostExtraction(retry.costJson);
      if (!validation.ok) {
        // Only the validator's complaint is logged – never the raw answer,
        // which may echo document text.
        this.logger.warn(
          `Cost extraction from provider '${adapter.providerKey}' was off-schema twice: ${validation.error}`,
        );
        throw new ServiceUnavailableException('AI_COST_EXTRACTION_INVALID_FORMAT');
      }
    }

    // Already stored entries for this document: shown so the user can avoid a
    // duplicate – a hint only, entering the costs again stays possible.
    const existingEntries = await this.db.policyCostEntry.findMany({
      where: { policyId, sourceDocumentId: document.id },
      orderBy: { validFrom: 'desc' },
      select: { id: true, validFrom: true, validTo: true, grossAmount: true, netAmount: true, frequency: true },
    });

    return {
      document: {
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        documentDate: document.documentDate,
      },
      suggestion: validation.value,
      existingEntries,
      model: answer.model,
      providerKey: adapter.providerKey,
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
   *
   * BugFix-22: additionally returns a machine-readable reason why the
   * provider is unavailable, so the UI can explain the situation instead of
   * always claiming "the configured provider does not answer". Reasons never
   * contain URLs, hostnames or credentials.
   */
  async healthCheck(): Promise<AiHealthCheckResult> {
    const enabled = await this.settings.getEffectiveBoolean('AI_ENABLED');
    if (!enabled) {
      return { connected: false, provider: 'none', reason: 'disabled', capable: false };
    }

    const adapter = await this.providerRegistry.getAdapter();
    const status: AiHealthStatus = adapter.healthStatus
      ? await adapter.healthStatus()
      : { connected: await adapter.healthCheck(), reason: null };

    // An unknown AI_PROVIDER value silently falls back to the NoOp adapter
    // (providerKey "none") – report that as "not configured" rather than
    // "provider not answering", which would be misleading.
    const reason: AiHealthReason | null = status.connected
      ? null
      : (status.reason ??
        (adapter.providerKey === 'none' ? 'not-configured' : 'unreachable'));

    return { connected: status.connected, provider: adapter.providerKey, reason, capable: status.connected };
  }
}
