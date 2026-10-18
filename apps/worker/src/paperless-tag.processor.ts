import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import {
  DatabaseService,
  SettingsResolverService,
  isPaperlessTagSyncDue,
  paperlessTagSyncIntervalMs,
} from '@versigo/foundation';
import { PaperlessTagClient, type TagDocumentRef } from './paperless-tag.client';
import {
  PAPERLESS_TAG_DEFAULT_INTERVAL_MS,
  PAPERLESS_TAG_QUEUE,
  PAPERLESS_TAG_RECONCILE_JOB,
  PAPERLESS_TAG_RECONCILE_JOB_ID,
  PAPERLESS_TAG_RECONCILE_TICK_MS,
  PAPERLESS_TAG_SYNC_POLICY_JOB,
  PAPERLESS_TAG_TAG_DOCUMENT_JOB,
} from './paperless-tag.constants';

interface TagJobData {
  jobId: string;
  policyId: string;
}

/**
 * AP-24 (§1.1): how one reconciliation run changed the local document list.
 * `added`/`removed` are the counts the UI shows as "neu"/"entfernt";
 * `updated` covers metadata refreshes of existing links and is folded into
 * "unverändert" for the user because the link itself did not change.
 */
export interface ReconcileCounts {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

/** AP-24 (§1.1): reconciliation result plus the abort flag. */
export interface ReconcileOutcome extends ReconcileCounts {
  aborted: boolean;
}

/**
 * AP-24 (§1.1): throttles the per-document progress writes. A tag with
 * thousands of documents must not turn into thousands of UPDATE statements,
 * so only every Nth document is flushed; the final counts are written by the
 * caller when the job finishes.
 */
const PROGRESS_WRITE_STRIDE = 10;

async function maybeReportProgress(
  onProgress: ((processed: number) => Promise<void>) | undefined,
  processed: number,
): Promise<void> {
  if (!onProgress) return;
  if (processed % PROGRESS_WRITE_STRIDE !== 0) return;
  await onProgress(processed);
}

/** AP-24 (§1.1): the job columns derived from one reconciliation run
 * (`totalCount` is written separately as soon as the remote list is known). */
export interface SyncProgressFields {
  processedCount: number;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

/**
 * AP-24 (§1.1): maps the reconciliation tally onto the job columns.
 * Metadata refreshes (`updated`) do not change the set of linked documents,
 * so they are reported to the user as "unverändert".
 */
export function toProgressFields(outcome: ReconcileOutcome): SyncProgressFields {
  return {
    addedCount: outcome.added,
    removedCount: outcome.removed,
    unchangedCount: outcome.unchanged + outcome.updated,
    processedCount: outcome.added + outcome.unchanged + outcome.updated,
  };
}

/**
 * BugFix-21: metadata of an already existing tag link, as far as the
 * reconciliation needs it to decide what to write.
 */
export interface ExistingTagLinkMetadata {
  linkOriginManual: boolean;
  fileName: string | null;
  documentDate: Date | null;
  mimeType: string | null;
}

/** BugFix-21: the metadata fields the sync writes for one document. */
export interface TagLinkMetadataUpdate {
  fileName?: string;
  documentDate?: Date;
  mimeType?: string;
}

/**
 * BugFix-21: parses a Paperless date/time string. Unusable values yield null
 * so no garbage date is stored (the UI then simply shows no date).
 */
export function parsePaperlessDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * BugFix-21: derives the metadata the sync writes for one tag document.
 *
 * Paperless is the source of truth for documents the sync manages on its own
 * (`!linkOriginManual`): a rename, a corrected document date or a changed MIME
 * type in Paperless is propagated on the next sync. For a document with a
 * manual origin the user's values win and only genuinely missing values are
 * filled – editing a linked document in VersiGo must never be undone by the
 * background sync.
 */
export function deriveTagLinkMetadata(
  remote: TagDocumentRef,
  existing: ExistingTagLinkMetadata | null,
): TagLinkMetadataUpdate {
  const autoManaged = existing === null || !existing.linkOriginManual;
  const update: TagLinkMetadataUpdate = {};

  const title = remote.title?.trim();
  if (title) {
    const current = (existing?.fileName ?? '').trim();
    if (autoManaged ? current !== title : current.length === 0) {
      update.fileName = title;
    }
  }

  const documentDate = parsePaperlessDate(remote.createdAt);
  if (documentDate) {
    const current = existing?.documentDate ?? null;
    const mayWrite = autoManaged || current === null;
    if (mayWrite && (current === null || current.getTime() !== documentDate.getTime())) {
      update.documentDate = documentDate;
    }
  }

  const mimeType = remote.mimeType?.trim();
  if (mimeType) {
    const current = existing?.mimeType ?? null;
    const mayWrite = autoManaged || current === null;
    if (mayWrite && current !== mimeType) {
      update.mimeType = mimeType;
    }
  }

  return update;
}

/**
 * AP-22: worker processor for the tag-based Paperless document assignment.
 *
 * Design notes:
 * - The DB row in `paperless_tag_jobs` is the durable outbox; BullMQ is only
 *   the transport. Idempotency comes from the row status, not from BullMQ.
 * - Every job checks the current configuration version before doing any work,
 *   so a job queued for an older tag/connection can never overwrite a newer
 *   configuration.
 * - A failed or partial reconciliation NEVER removes existing assignments:
 *   removal happens only after a fully successful page walk.
 * - Retries are durable: a retryable failure resets the row to PENDING and
 *   the reconciliation tick re-dispatches it (bounded by maxRetries).
 */
@Processor(PAPERLESS_TAG_QUEUE)
export class PaperlessTagProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PaperlessTagProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsResolverService,
    @InjectQueue(PAPERLESS_TAG_QUEUE) private readonly queue: Queue,
    private readonly client: PaperlessTagClient,
  ) {
    super();
  }

  /**
   * Registers the repeatable reconciliation tick as well.
   *
   * The API also registers it (so the tick exists even before a worker is
   * running), but if Redis was unavailable during the API bootstrap the
   * worker must be able to (re)create it – otherwise neither the periodic
   * sync nor the re-dispatch of PENDING outbox rows would resume until an
   * API restart. The job id and repeat options are identical in both apps,
   * so this is an idempotent upsert of the same repeatable job.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        PAPERLESS_TAG_RECONCILE_JOB,
        {},
        {
          repeat: { every: PAPERLESS_TAG_RECONCILE_TICK_MS },
          jobId: PAPERLESS_TAG_RECONCILE_JOB_ID,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Could not register the Paperless tag reconciliation tick from the worker: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  async process(job: Job<TagJobData>): Promise<{ success: boolean; error?: string }> {
    try {
      switch (job.name) {
        case PAPERLESS_TAG_SYNC_POLICY_JOB:
          return await this.handleSyncPolicy(job.data.jobId, job.data.policyId);
        case PAPERLESS_TAG_TAG_DOCUMENT_JOB:
          return await this.handleTagDocument(job.data.jobId, job.data.policyId);
        case PAPERLESS_TAG_RECONCILE_JOB:
          return await this.handleReconcile();
        default:
          this.logger.warn(`Unknown Paperless tag job: ${job.name}`);
          return { success: false, error: 'UNKNOWN_JOB' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Paperless tag job ${job.name} (${job.id}) failed: ${message}`);
      return { success: false, error: message };
    }
  }

  // --- Enqueue helper (durable outbox -> BullMQ) ---------------------------

  private async enqueueRow(row: {
    id: string;
    policyId: string;
    kind: 'SYNC_POLICY' | 'TAG_DOCUMENT';
  }): Promise<void> {
    const name =
      row.kind === 'SYNC_POLICY'
        ? PAPERLESS_TAG_SYNC_POLICY_JOB
        : PAPERLESS_TAG_TAG_DOCUMENT_JOB;
    try {
      await this.queue.add(
        name,
        { jobId: row.id, policyId: row.policyId },
        { jobId: row.id, removeOnComplete: true, removeOnFail: true },
      );
    } catch (err) {
      this.logger.warn(
        `Could not enqueue Paperless tag job ${row.id}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  private async skipJob(jobId: string, code: string): Promise<{ success: boolean }> {
    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: { status: 'SKIPPED', errorCode: code, completedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * AP-22: an archived (or removed) insurance must not be synced any more.
   * Policies are archived rather than hard deleted, so the worker has to
   * check this on every job instead of relying on the FK cascade alone.
   */
  private async isPolicyArchived(policyId: string): Promise<boolean> {
    const policy = await this.db.insurancePolicy.findUnique({
      where: { id: policyId },
      select: { archivedAt: true },
    });
    return !policy || Boolean(policy.archivedAt);
  }

  /**
   * Marks a retryable failure: the row goes back to PENDING with an
   * incremented retry counter; the reconciliation tick re-dispatches it.
   * Once the retry budget is exhausted the row is marked FAILED.
   */
  private async retryOrFail(
    jobId: string,
    retryCount: number,
    maxRetries: number,
    code: string,
  ): Promise<{ success: boolean; error: string }> {
    if (retryCount < maxRetries) {
      await this.db.paperlessTagJob.update({
        where: { id: jobId },
        data: { status: 'PENDING', retryCount: { increment: 1 }, errorCode: code },
      });
      return { success: false, error: code };
    }
    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorCode: code, completedAt: new Date() },
    });
    return { success: false, error: code };
  }

  // --- SYNC_POLICY ---------------------------------------------------------

  /**
   * AP-24 (§1.1): flushes the intermediate "documents processed" counter so
   * the UI can advance the progress bar while the worker is still walking the
   * remote list. Failures here must never fail the sync itself.
   */
  private async reportProgress(jobId: string, processed: number): Promise<void> {
    try {
      await this.db.paperlessTagJob.update({
        where: { id: jobId },
        data: { processedCount: processed },
      });
    } catch (err) {
      this.logger.warn(`Could not write sync progress for ${jobId}: ${String(err)}`);
    }
  }

  private async handleSyncPolicy(
    jobId: string,
    policyId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const job = await this.db.paperlessTagJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === 'COMPLETED' || job.status === 'SKIPPED') {
      return { success: true };
    }

    const config = await this.db.policyPaperlessTag.findUnique({ where: { policyId } });
    if (!config || config.configVersion !== job.configVersion) {
      // Tag removed or changed after this job was queued: never touch the
      // current configuration.
      return this.skipJob(jobId, 'STALE_CONFIG');
    }

    if (await this.isPolicyArchived(policyId)) {
      // The insurance was archived or removed: invalidate the sync job.
      return this.skipJob(jobId, 'POLICY_ARCHIVED');
    }

    // Connection drift (admin pointed Paperless at another server).
    const currentBaseUrl = await this.client.baseUrl();
    if (config.connectionRef && currentBaseUrl && config.connectionRef !== currentBaseUrl) {
      await this.db.policyPaperlessTag.updateMany({
        where: { policyId, configVersion: job.configVersion },
        data: { syncStatus: 'ERROR', syncErrorCode: 'CONNECTION_CHANGED' },
      });
      return this.skipJob(jobId, 'CONNECTION_CHANGED');
    }

    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        // AP-24 (§1.1): a fresh run starts from a clean slate so the UI never
        // shows the previous run's counters as if they belonged to this one.
        processedCount: 0,
        totalCount: null,
        addedCount: 0,
        removedCount: 0,
        unchangedCount: 0,
      },
    });

    const lookup = await this.client.getTag(config.paperlessTagId);
    if (!lookup.ok) {
      if (lookup.error === 'UNREACHABLE') {
        // Outage: keep the last known assignments and retry later.
        return this.retryOrFail(jobId, job.retryCount, job.maxRetries, 'UNREACHABLE');
      }
      // NOT_FOUND (tag really deleted) / AUTH_FAILED / NOT_CONFIGURED:
      // surface the reason, keep assignments, do not create a replacement
      // tag without a deliberate user action.
      await this.db.policyPaperlessTag.updateMany({
        where: { policyId, configVersion: job.configVersion },
        data: {
          syncStatus: 'ERROR',
          syncErrorCode: lookup.error,
        },
      });
      return this.retryOrFail(jobId, job.maxRetries, job.maxRetries, lookup.error);
    }

    const remote = await this.client.listDocumentsByTag(config.paperlessTagId);
    if (!remote) {
      await this.db.policyPaperlessTag.updateMany({
        where: { policyId, configVersion: job.configVersion },
        data: { syncStatus: 'ERROR', syncErrorCode: 'SYNC_FAILED' },
      });
      return this.retryOrFail(jobId, job.retryCount, job.maxRetries, 'SYNC_FAILED');
    }

    // AP-24 (§1.1): the total is known as soon as the remote list is in, so
    // the UI can switch from the indeterminate bar to a determinate one.
    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: { totalCount: remote.length },
    });

    const outcome = await this.reconcileAssignments(
      policyId,
      job.configVersion,
      remote,
      (processed) => this.reportProgress(jobId, processed),
    );

    if (outcome.aborted) {
      // The configuration changed while this run was walking the remote
      // documents. Reporting success or writing ACTIVE/backfill state here
      // would overwrite the newer configuration's progress (round-3 review).
      await this.db.paperlessTagJob.update({
        where: { id: jobId },
        data: {
          status: 'SKIPPED',
          errorCode: 'STALE_CONFIG',
          completedAt: new Date(),
          ...toProgressFields(outcome),
        },
      });
      return { success: true };
    }

    // Only a fully successful reconciliation updates the sync state.
    await this.db.policyPaperlessTag.updateMany({
      where: { policyId, configVersion: job.configVersion },
      data: {
        lastSyncedAt: new Date(),
        syncStatus: 'ACTIVE',
        syncErrorCode: null,
        paperlessTagName: lookup.name,
      },
    });

    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        errorCode: null,
        completedAt: new Date(),
        ...toProgressFields(outcome),
      },
    });

    // Backfill: manually linked documents also receive the new tag.
    await this.scheduleManualLinkBackfill(policyId, job.configVersion);

    return { success: true };
  }

  /**
   * Merges the Paperless tag membership into the local document list:
   * documents with the tag become visible (origin TAG), documents that lost
   * the tag lose only the automatic origin (a manual link is preserved).
   *
   * Returns `{ aborted: true }` when the run was aborted because the
   * configuration changed underneath it (round-3 review: the caller must not
   * report such a run as completed nor backfill with a stale config version).
   *
   * `onProgress` is called with the number of remote documents processed so
   * far; it is deliberately throttled inside so a big tag does not turn into
   * one database write per document.
   */
  private async reconcileAssignments(
    policyId: string,
    configVersion: number,
    remote: TagDocumentRef[],
    onProgress?: (processed: number) => Promise<void>,
  ): Promise<ReconcileOutcome> {
    const remoteById = new Map<string, TagDocumentRef>();
    for (const doc of remote) remoteById.set(String(doc.paperlessId), doc);

    // AP-24 (§1.1): running tally of what this run actually changed. It is
    // written to the job row so the UI can show "neu / entfernt / unverändert"
    // without re-reading the whole document list.
    const counts: ReconcileCounts = { added: 0, updated: 0, unchanged: 0, removed: 0 };
    // AP-24 (§1.1): how many remote documents have been walked so far.
    let processed = 0;

    const localLinks = await this.db.policyDocument.findMany({
      where: { policyId, storageType: 'PAPERLESS_LINK', archivedAt: null },
      select: {
        id: true,
        storageRef: true,
        linkOriginManual: true,
        linkOriginTag: true,
        // BugFix-21: the current metadata decides whether the sync may
        // refresh it (automatically managed) or only fill gaps.
        fileName: true,
        documentDate: true,
        mimeType: true,
      },
    });
    const localByRef = new Map<string, (typeof localLinks)[number]>();
    for (const link of localLinks) {
      if (link.storageRef) localByRef.set(link.storageRef, link);
    }

    for (const [ref, remoteDoc] of remoteById) {
      // Re-check the configuration before each write so a concurrent change
      // is not overwritten by a stale reconciliation.
      const fresh = await this.db.policyPaperlessTag.findUnique({
        where: { policyId },
        select: { configVersion: true },
      });
      if (!fresh || fresh.configVersion !== configVersion) return { aborted: true, ...counts };

      processed += 1;
      await maybeReportProgress(onProgress, processed);

      const existing = localByRef.get(ref);
      if (existing) {
        // BugFix-21: refresh the Paperless-derived metadata of automatically
        // managed documents and fill gaps of manually linked ones. Nothing is
        // written when nothing changed, so a no-op sync stays cheap.
        const data: TagLinkMetadataUpdate & { linkOriginTag?: boolean } = {
          ...deriveTagLinkMetadata(remoteDoc, existing),
        };
        if (!existing.linkOriginTag) data.linkOriginTag = true;

        if (Object.keys(data).length > 0) {
          await this.db.policyDocument.update({
            where: { id: existing.id },
            data,
          });
          counts.updated += 1;
        } else {
          counts.unchanged += 1;
        }
        continue;
      }

      const metadata = deriveTagLinkMetadata(remoteDoc, null);
      try {
        await this.db.policyDocument.create({
          data: {
            policyId,
            storageType: 'PAPERLESS_LINK',
            fileName: metadata.fileName || `Paperless document ${ref}`,
            storageRef: ref,
            linkOriginTag: true,
            linkOriginManual: false,
            ...(metadata.documentDate ? { documentDate: metadata.documentDate } : {}),
            ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
          },
        });
        counts.added += 1;
      } catch (err) {
        // Parallel sync created the same row (partial unique index).
        if ((err as { code?: string }).code === 'P2002') {
          await this.db.policyDocument.updateMany({
            where: {
              policyId,
              storageType: 'PAPERLESS_LINK',
              storageRef: ref,
              archivedAt: null,
            },
            data: { linkOriginTag: true },
          });
          counts.unchanged += 1;
        } else {
          throw err;
        }
      }
    }

    for (const link of localLinks) {
      if (!link.linkOriginTag) continue;
      if (link.storageRef && remoteById.has(link.storageRef)) continue;

      const fresh = await this.db.policyPaperlessTag.findUnique({
        where: { policyId },
        select: { configVersion: true },
      });
      if (!fresh || fresh.configVersion !== configVersion) return { aborted: true, ...counts };

      if (link.linkOriginManual) {
        // Manual links survive a lost tag – only the automatic origin goes.
        await this.db.policyDocument.update({
          where: { id: link.id },
          data: { linkOriginTag: false },
        });
      } else {
        // Automatically assigned document without manual origin: hide it.
        await this.db.policyDocument.update({
          where: { id: link.id },
          data: { linkOriginTag: false, archivedAt: new Date() },
        });
      }
      counts.removed += 1;
    }

    return { aborted: false, ...counts };
  }

  /**
   * Queues an additive tag assignment for every manually linked Paperless
   * document of the policy that does not yet carry the tag. This covers both
   * documents linked before the tag was configured and documents whose
   * assignment previously failed.
   */
  private async scheduleManualLinkBackfill(
    policyId: string,
    configVersion: number,
  ): Promise<void> {
    // Re-check the configuration version: a change between the reconciliation
    // and this backfill must not enqueue assignments for a superseded tag.
    const current = await this.db.policyPaperlessTag.findUnique({
      where: { policyId },
      select: { configVersion: true },
    });
    if (!current || current.configVersion !== configVersion) return;

    const documents = await this.db.policyDocument.findMany({
      where: {
        policyId,
        storageType: 'PAPERLESS_LINK',
        archivedAt: null,
        linkOriginManual: true,
        storageRef: { not: null },
        OR: [{ taggingStatus: null }, { taggingStatus: { not: 'APPLIED' } }],
      },
      select: { id: true },
      take: 200,
    });

    for (const doc of documents) {
      const active = await this.db.paperlessTagJob.findFirst({
        where: {
          policyId,
          documentId: doc.id,
          kind: 'TAG_DOCUMENT',
          status: { in: ['PENDING', 'RUNNING'] },
        },
      });
      if (active) continue;

      const job = await this.db.$transaction(async (tx) => {
        await tx.policyDocument.update({
          where: { id: doc.id },
          data: { taggingStatus: 'PENDING', taggingErrorCode: null },
        });
        return tx.paperlessTagJob.create({
          data: {
            policyId,
            documentId: doc.id,
            kind: 'TAG_DOCUMENT',
            status: 'PENDING',
            configVersion,
          },
        });
      });

      await this.enqueueRow({ id: job.id, policyId, kind: 'TAG_DOCUMENT' });
    }
  }

  // --- TAG_DOCUMENT --------------------------------------------------------

  private async handleTagDocument(
    jobId: string,
    policyId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const job = await this.db.paperlessTagJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === 'COMPLETED' || job.status === 'SKIPPED') {
      return { success: true };
    }

    const config = await this.db.policyPaperlessTag.findUnique({ where: { policyId } });
    if (!config || config.configVersion !== job.configVersion) {
      // The tag was removed or changed – never assign the removed tag.
      return this.skipJob(jobId, 'STALE_CONFIG');
    }

    if (await this.isPolicyArchived(policyId)) {
      return this.skipJob(jobId, 'POLICY_ARCHIVED');
    }

    // Connection drift (round-4 review): the numeric document/tag ids are only
    // meaningful for the server they were read from. If an admin repointed
    // PAPERLESS_URL after this row was queued, applying the tag could hit an
    // unrelated document on the foreign instance. Mirror handleSyncPolicy and
    // never perform the external write in that case.
    const currentBaseUrl = await this.client.baseUrl();
    if (config.connectionRef && currentBaseUrl && config.connectionRef !== currentBaseUrl) {
      await this.db.policyPaperlessTag.updateMany({
        where: { policyId, configVersion: job.configVersion },
        data: { syncStatus: 'ERROR', syncErrorCode: 'CONNECTION_CHANGED' },
      });
      return this.skipJob(jobId, 'CONNECTION_CHANGED');
    }

    const document = await this.db.policyDocument.findFirst({
      where: { id: job.documentId ?? '', policyId, archivedAt: null },
    });
    if (!document || document.storageType !== 'PAPERLESS_LINK' || !document.storageRef) {
      return this.skipJob(jobId, 'DOCUMENT_GONE');
    }

    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING' },
    });

    const result = await this.client.assignTagToDocument(
      Number(document.storageRef),
      config.paperlessTagId,
    );

    if (result.success && result.verified) {
      await this.db.policyDocument.update({
        where: { id: document.id },
        data: { taggingStatus: 'APPLIED', taggingErrorCode: null },
      });
      await this.db.paperlessTagJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', errorCode: null, completedAt: new Date() },
      });
      return { success: true };
    }

    const code = result.errorCode ?? 'UNKNOWN';
    const retryable = code === 'UNREACHABLE' || code === 'API_ERROR' || code === 'VERIFY_FAILED';

    if (retryable) {
      await this.db.policyDocument.update({
        where: { id: document.id },
        data: { taggingStatus: 'PENDING', taggingErrorCode: code },
      });
      return this.retryOrFail(jobId, job.retryCount, job.maxRetries, code);
    }

    // Non-retryable: the manual link stays, the assignment is failed and the
    // UI offers an explicit retry.
    await this.db.policyDocument.update({
      where: { id: document.id },
      data: { taggingStatus: 'FAILED', taggingErrorCode: code },
    });
    await this.db.paperlessTagJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorCode: code, completedAt: new Date() },
    });
    return { success: false, error: code };
  }

  // --- RECONCILE -----------------------------------------------------------

  /**
   * Periodic tick: re-dispatches durable PENDING rows (covers a failed
   * enqueue or a worker restart) and schedules the policies that are due for
   * their regular background sync.
   */
  private async handleReconcile(): Promise<{ success: boolean }> {
    const pending = await this.db.paperlessTagJob.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, policyId: true, kind: true },
    });
    for (const row of pending) {
      await this.enqueueRow(row);
    }

    // AP-24 (§1.2): read on every tick, so switching the automatic sync off
    // takes effect without a restart. Only *new* background runs are
    // prevented above: durable rows (manual or previously scheduled syncs)
    // are still re-dispatched and jobs already running are never aborted.
    const autoSyncEnabled =
      (await this.settings.getEffectiveBoolean('PAPERLESS_TAG_SYNC_ENABLED')) ?? true;
    if (!autoSyncEnabled) {
      this.logger.debug(
        'Paperless tag background sync is disabled – no new automatic syncs are scheduled',
      );
      return { success: true };
    }

    const intervalMs = paperlessTagSyncIntervalMs(
      (await this.settings.getEffectiveNumber('PAPERLESS_TAG_SYNC_INTERVAL_MS')) ??
        PAPERLESS_TAG_DEFAULT_INTERVAL_MS,
    );
    const dueBefore = new Date(Date.now() - Math.max(1_000, intervalMs));

    const dueConfigs = await this.db.policyPaperlessTag.findMany({
      where: {
        // Archived insurances are no longer synced (AP-22).
        policy: { archivedAt: null },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }],
      },
      select: { policyId: true, configVersion: true, lastSyncedAt: true },
      take: 500,
    });

    const now = new Date();
    for (const config of dueConfigs) {
      // AP-24 (§1.2): the DB query above is the cheap pre-filter; the
      // deterministic per-policy offset makes sure insurances that became
      // due in the same tick do not all start at the same instant.
      if (
        !isPaperlessTagSyncDue({
          policyId: config.policyId,
          lastSyncedAt: config.lastSyncedAt,
          now,
          intervalMs,
        })
      ) {
        continue;
      }

      const active = await this.db.paperlessTagJob.findFirst({
        where: {
          policyId: config.policyId,
          kind: 'SYNC_POLICY',
          status: { in: ['PENDING', 'RUNNING'] },
        },
      });
      if (active) continue;

      const job = await this.db.paperlessTagJob.create({
        data: {
          policyId: config.policyId,
          kind: 'SYNC_POLICY',
          status: 'PENDING',
          configVersion: config.configVersion,
        },
      });
      await this.enqueueRow({ id: job.id, policyId: config.policyId, kind: 'SYNC_POLICY' });
    }

    return { success: true };
  }
}
