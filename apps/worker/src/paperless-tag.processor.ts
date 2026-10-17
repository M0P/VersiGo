import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DatabaseService, SettingsResolverService } from '@versigo/foundation';
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
      data: { status: 'RUNNING' },
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

    const aborted = await this.reconcileAssignments(policyId, job.configVersion, remote);

    if (aborted) {
      // The configuration changed while this run was walking the remote
      // documents. Reporting success or writing ACTIVE/backfill state here
      // would overwrite the newer configuration's progress (round-3 review).
      await this.db.paperlessTagJob.update({
        where: { id: jobId },
        data: {
          status: 'SKIPPED',
          errorCode: 'STALE_CONFIG',
          completedAt: new Date(),
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
      data: { status: 'COMPLETED', errorCode: null, completedAt: new Date() },
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
   * Returns `true` when the run was aborted because the configuration
   * changed underneath it (round-3 review: the caller must not report such a
   * run as completed nor backfill with a stale config version).
   */
  private async reconcileAssignments(
    policyId: string,
    configVersion: number,
    remote: TagDocumentRef[],
  ): Promise<boolean> {
    const remoteById = new Map<string, TagDocumentRef>();
    for (const doc of remote) remoteById.set(String(doc.paperlessId), doc);

    const localLinks = await this.db.policyDocument.findMany({
      where: { policyId, storageType: 'PAPERLESS_LINK', archivedAt: null },
      select: { id: true, storageRef: true, linkOriginManual: true, linkOriginTag: true },
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
      if (!fresh || fresh.configVersion !== configVersion) return true;

      const existing = localByRef.get(ref);
      if (existing) {
        if (!existing.linkOriginTag) {
          await this.db.policyDocument.update({
            where: { id: existing.id },
            data: { linkOriginTag: true },
          });
        }
        continue;
      }

      try {
        await this.db.policyDocument.create({
          data: {
            policyId,
            storageType: 'PAPERLESS_LINK',
            fileName: remoteDoc.title?.trim() || `Paperless document ${ref}`,
            storageRef: ref,
            linkOriginTag: true,
            linkOriginManual: false,
          },
        });
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
      if (!fresh || fresh.configVersion !== configVersion) return true;

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
    }

    return false;
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

    const intervalMs =
      (await this.settings.getEffectiveNumber('PAPERLESS_TAG_SYNC_INTERVAL_MS')) ??
      PAPERLESS_TAG_DEFAULT_INTERVAL_MS;
    const dueBefore = new Date(Date.now() - Math.max(1_000, intervalMs));

    const dueConfigs = await this.db.policyPaperlessTag.findMany({
      where: {
        // Archived insurances are no longer synced (AP-22).
        policy: { archivedAt: null },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }],
      },
      select: { policyId: true, configVersion: true },
      take: 500,
    });

    for (const config of dueConfigs) {
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
