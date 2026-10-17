import {
  BadGatewayException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService, SettingsResolverService } from '@versigo/foundation';
import type { AiJobStatus, Prisma } from '@prisma/client';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import {
  PAPERLESS_ADAPTER,
  IPaperlessAdapter,
  PaperlessTagPage,
  PaperlessTagSummary,
} from './paperless-ngx.interface';
import {
  PAPERLESS_TAG_QUEUE,
  PAPERLESS_TAG_RECONCILE_JOB,
  PAPERLESS_TAG_RECONCILE_JOB_ID,
  PAPERLESS_TAG_RECONCILE_TICK_MS,
  PAPERLESS_TAG_SYNC_POLICY_JOB,
  PAPERLESS_TAG_TAG_DOCUMENT_JOB,
} from './paperless-tag.constants';

/**
 * AP-22: configuration of the optional Paperless tag per insurance policy,
 * plus the durable (outbox) enqueueing of the tag jobs.
 *
 * The service never performs external Paperless I/O for the actual sync –
 * that is the worker's job. It only talks to Paperless for the interactive
 * tag search / tag creation so the user gets immediate feedback, and it
 * records every job durably in `paperless_tag_jobs` BEFORE pushing it to
 * BullMQ. A failed enqueue therefore stays PENDING and is re-dispatched by
 * the periodic reconciliation, so no job is lost between the DB change and
 * the queue insertion.
 */
@Injectable()
export class PaperlessTagService implements OnModuleInit {
  private readonly logger = new Logger(PaperlessTagService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
    private readonly settings: SettingsResolverService,
    @Inject(PAPERLESS_ADAPTER) private readonly paperless: IPaperlessAdapter,
    @InjectQueue(PAPERLESS_TAG_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Periodic background reconciliation (no Paperless webhooks required).
    // The tick cadence is a code constant; the effective per-policy interval
    // is read from PAPERLESS_TAG_SYNC_INTERVAL_MS on every tick so admin
    // changes apply without a restart.
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
      // Redis unavailable at bootstrap: the repeatable job is (re)registered
      // on the next successful start. Job enqueueing is unaffected.
      this.logger.warn(
        `Could not register the Paperless tag reconciliation tick: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
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

  private async assertPolicyWriteAccess(
    householdId: string,
    userId: string,
    policyId: string,
  ): Promise<{ id: string; insurerName: string }> {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId, archivedAt: null },
      select: { id: true, insurerName: true },
    });
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }
    return policy;
  }

  /** Effective Paperless base URL – identifies the authorised connection. */
  private async connectionRef(): Promise<string> {
    const url = (await this.settings.getEffectiveString('PAPERLESS_URL')) ?? '';
    return url.replace(/\/+$/, '');
  }

  // --- Interactive tag catalogue -------------------------------------------

  async searchTags(
    householdId: string,
    user: AuthenticatedUser,
    search: string,
    page: number,
  ): Promise<PaperlessTagPage> {
    await this.assertHouseholdAccess(householdId, user.id);
    return this.paperless.searchTags(search, page, 20);
  }

  /**
   * Creates a tag in Paperless after a deliberate user action. The adapter
   * is idempotent: an existing identical name is returned instead of being
   * duplicated (parallel creation attempts included).
   */
  async createTag(
    householdId: string,
    user: AuthenticatedUser,
    name: string,
  ): Promise<PaperlessTagSummary> {
    await this.assertHouseholdAccess(householdId, user.id);

    const created = await this.paperless.createTag(name);
    if (!created) {
      throw new BadGatewayException(
        'PAPERLESS_TAG_CREATE_FAILED: the tag could not be created in Paperless',
      );
    }
    return created;
  }

  // --- Per-policy tag configuration ----------------------------------------

  async getConfig(householdId: string, user: AuthenticatedUser, policyId: string) {
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const config = await this.db.policyPaperlessTag.findUnique({ where: { policyId } });
    if (!config) return null;

    // AP-22: the UI shows which Paperless connection the assignment belongs
    // to. Only the (non-secret) base URL is exposed – never the API token.
    const currentConnection = await this.connectionRef();

    return {
      policyId: config.policyId,
      paperlessTagId: config.paperlessTagId,
      paperlessTagName: config.paperlessTagName,
      configVersion: config.configVersion,
      lastSyncedAt: config.lastSyncedAt,
      syncStatus: config.syncStatus,
      syncErrorCode: config.syncErrorCode,
      connection: config.connectionRef,
      connectionChanged: Boolean(
        config.connectionRef && currentConnection && config.connectionRef !== currentConnection,
      ),
    };
  }

  /**
   * Assigns or changes the policy tag. The external tag is verified against
   * the authorised connection before it is stored (never trust a
   * client-provided connection/tag ownership).
   *
   * Staleness: the configuration version is incremented on every change and
   * carried by every queued job. Jobs that still reference the previous
   * version are discarded by the worker instead of overwriting the new
   * configuration.
   */
  async setTag(
    householdId: string,
    userId: string,
    policyId: string,
    tagId: number,
    tagName?: string,
  ) {
    await this.assertPolicyWriteAccess(householdId, userId, policyId);

    const lookup = await this.paperless.getTag(tagId);
    if (!lookup.ok) {
      const code = lookup.error.kind;
      if (code === 'NOT_CONFIGURED') {
        throw new BadGatewayException('PAPERLESS_NOT_CONFIGURED');
      }
      if (code === 'NOT_FOUND') {
        throw new NotFoundException('PAPERLESS_TAG_NOT_FOUND');
      }
      throw new BadGatewayException(`PAPERLESS_TAG_LOOKUP_FAILED: ${code}`);
    }

    const connectionRef = await this.connectionRef();
    // The tag name always comes from Paperless (authoritative), the client
    // value is only a fallback when the API returned no name.
    const resolvedName = lookup.tag.name || tagName || null;

    const { config, jobId } = await this.db.$transaction(async (tx) => {
      const existing = await tx.policyPaperlessTag.findUnique({ where: { policyId } });

      const saved = existing
        ? await tx.policyPaperlessTag.update({
            where: { policyId },
            data: {
              paperlessTagId: tagId,
              paperlessTagName: resolvedName,
              connectionRef,
              configVersion: { increment: 1 },
              syncStatus: 'PENDING',
              syncErrorCode: null,
            },
          })
        : await tx.policyPaperlessTag.create({
            data: {
              policyId,
              paperlessTagId: tagId,
              paperlessTagName: resolvedName,
              connectionRef,
              configVersion: 1,
              syncStatus: 'PENDING',
            },
          });

      // Supersede jobs of the previous configuration so they cannot
      // re-assign the old tag after the change.
      await tx.paperlessTagJob.updateMany({
        where: { policyId, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'SKIPPED', completedAt: new Date(), errorCode: 'SUPERSEDED' },
      });

      // When the tag itself changes, previously confirmed assignments belong
      // to the old tag. Reset them to PENDING so the backfill re-queues them
      // for the new tag (AP-22: "Tag ändern: ergänze den neuen Tag bei allen
      // manuell verlinkten Dokumenten").
      if (existing && existing.paperlessTagId !== tagId) {
        await tx.policyDocument.updateMany({
          where: { policyId, linkOriginManual: true, taggingStatus: 'APPLIED' },
          data: { taggingStatus: 'PENDING', taggingErrorCode: null },
        });
      }

      const job = await tx.paperlessTagJob.create({
        data: {
          policyId,
          kind: 'SYNC_POLICY',
          status: 'PENDING',
          configVersion: saved.configVersion,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyPaperlessTag',
          entityId: saved.id,
          action: existing ? 'PAPERLESS_TAG_CHANGED' : 'PAPERLESS_TAG_SET',
          diffJson: {
            policyId,
            paperlessTagId: tagId,
            paperlessTagName: resolvedName,
            configVersion: saved.configVersion,
            previousTagId: existing?.paperlessTagId ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return { config: saved, jobId: job.id };
    });

    await this.enqueue(PAPERLESS_TAG_SYNC_POLICY_JOB, jobId, policyId);

    return {
      policyId: config.policyId,
      paperlessTagId: config.paperlessTagId,
      paperlessTagName: config.paperlessTagName,
      configVersion: config.configVersion,
      lastSyncedAt: config.lastSyncedAt,
      syncStatus: config.syncStatus,
      syncErrorCode: config.syncErrorCode,
    };
  }

  /**
   * Deactivates the automatic tag assignment. Only the automatic origin is
   * removed; every manual link is preserved. Neither the Paperless tag nor
   * any Paperless document is touched. Pending jobs are superseded so they
   * cannot re-assign the removed tag.
   */
  async removeTag(householdId: string, userId: string, policyId: string) {
    await this.assertPolicyWriteAccess(householdId, userId, policyId);

    const result = await this.db.$transaction(async (tx) => {
      const existing = await tx.policyPaperlessTag.findUnique({ where: { policyId } });
      if (!existing) return { removed: false };

      await tx.policyPaperlessTag.delete({ where: { policyId } });

      await tx.paperlessTagJob.updateMany({
        where: { policyId, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'SKIPPED', completedAt: new Date(), errorCode: 'TAG_REMOVED' },
      });

      // Only the automatic origin is dropped – documents that remain
      // manually linked stay visible. Documents that were assigned solely
      // through the tag lose their only origin and are archived (mirrors
      // the worker's reconcileAssignments behaviour).
      const now = new Date();
      const archived = await tx.policyDocument.updateMany({
        where: { policyId, linkOriginTag: true, linkOriginManual: false },
        data: { linkOriginTag: false, archivedAt: now },
      });
      const cleared = await tx.policyDocument.updateMany({
        where: { policyId, linkOriginTag: true, linkOriginManual: true },
        data: { linkOriginTag: false },
      });
      // The per-document tagging state is meaningless without a configured
      // tag. Reset it for *every* remaining manual link – not only the ones
      // that carried a tag origin: a manual link that was PENDING/FAILED or
      // APPLIED for the removed tag would otherwise keep a stale badge, a
      // retry button that fails with NO_PAPERLESS_TAG_CONFIGURED, and would
      // be skipped by the backfill of a later re-assignment.
      const resetTagging = await tx.policyDocument.updateMany({
        where: { policyId, linkOriginManual: true, archivedAt: null },
        data: { taggingStatus: null, taggingErrorCode: null },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyPaperlessTag',
          entityId: existing.id,
          action: 'PAPERLESS_TAG_REMOVED',
          diffJson: {
            policyId,
            paperlessTagId: existing.paperlessTagId,
            automaticOriginsCleared: cleared.count + archived.count,
            tagOnlyDocumentsArchived: archived.count,
            manualLinksReset: resetTagging.count,
          } as Prisma.InputJsonValue,
        },
      });

      return { removed: true };
    });

    return {
      policyId,
      tagRemoved: result.removed,
    };
  }

  /** Manual "refresh now": schedules an immediate full reconciliation. */
  async requestSync(householdId: string, userId: string, policyId: string) {
    await this.assertPolicyWriteAccess(householdId, userId, policyId);

    const config = await this.db.policyPaperlessTag.findUnique({ where: { policyId } });
    if (!config) {
      throw new NotFoundException('NO_PAPERLESS_TAG_CONFIGURED');
    }

    const job = await this.db.paperlessTagJob.create({
      data: {
        policyId,
        kind: 'SYNC_POLICY',
        status: 'PENDING',
        configVersion: config.configVersion,
      },
    });

    await this.enqueue(PAPERLESS_TAG_SYNC_POLICY_JOB, job.id, policyId);

    return {
      jobId: job.id,
      status: 'PENDING' satisfies AiJobStatus,
      configVersion: config.configVersion,
    };
  }

  /** Status snapshot including the most recent failed jobs (for the UI). */
  async getStatus(householdId: string, user: AuthenticatedUser, policyId: string) {
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const [config, failedDocuments, lastJob] = await Promise.all([
      this.db.policyPaperlessTag.findUnique({ where: { policyId } }),
      this.db.policyDocument.findMany({
        where: {
          policyId,
          storageType: 'PAPERLESS_LINK',
          archivedAt: null,
          taggingStatus: { in: ['PENDING', 'FAILED'] },
        },
        select: {
          id: true,
          fileName: true,
          taggingStatus: true,
          taggingErrorCode: true,
        },
      }),
      this.db.paperlessTagJob.findFirst({
        where: { policyId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!config) {
      return { configured: false, taggingStates: failedDocuments, lastJob };
    }

    return {
      configured: true,
      paperlessTagId: config.paperlessTagId,
      paperlessTagName: config.paperlessTagName,
      configVersion: config.configVersion,
      lastSyncedAt: config.lastSyncedAt,
      syncStatus: config.syncStatus,
      syncErrorCode: config.syncErrorCode,
      taggingStates: failedDocuments,
      lastJob,
    };
  }

  /**
   * Retries failed/pending external tag assignments for the policy's
   * manually linked documents. Re-uses the durable outbox so the retry
   * survives an enqueue failure.
   */
  async retryTagging(
    householdId: string,
    userId: string,
    policyId: string,
    documentId?: string,
  ) {
    await this.assertPolicyWriteAccess(householdId, userId, policyId);

    const config = await this.db.policyPaperlessTag.findUnique({ where: { policyId } });
    if (!config) {
      throw new NotFoundException('NO_PAPERLESS_TAG_CONFIGURED');
    }

    const documents = await this.db.policyDocument.findMany({
      where: {
        policyId,
        storageType: 'PAPERLESS_LINK',
        archivedAt: null,
        storageRef: { not: null },
        linkOriginManual: true,
        taggingStatus: { in: ['PENDING', 'FAILED'] },
        ...(documentId ? { id: documentId } : {}),
      },
      select: { id: true },
      take: 200,
    });

    if (documents.length === 0) {
      return { scheduled: 0 };
    }

    const jobs = await this.db.$transaction(async (tx) => {
      const created: { id: string }[] = [];
      for (const document of documents) {
        const existing = await tx.paperlessTagJob.findFirst({
          where: {
            policyId,
            documentId: document.id,
            kind: 'TAG_DOCUMENT',
            status: { in: ['PENDING', 'RUNNING'] },
          },
        });
        if (existing) {
          // Already enqueued/scheduled; mark the document as PENDING once
          // more to reflect the retry action.
          await tx.policyDocument.update({
            where: { id: document.id },
            data: { taggingStatus: 'PENDING', taggingErrorCode: null },
          });
          // The row is already active. Re-enqueueing the same BullMQ job id is
          // safe (the outbox row, not BullMQ, is the source of truth), so the
          // id is collected here and re-pushed after the transaction commits.
          created.push({ id: existing.id });
          continue;
        }
        await tx.policyDocument.update({
          where: { id: document.id },
          data: { taggingStatus: 'PENDING', taggingErrorCode: null },
        });
        const job = await tx.paperlessTagJob.create({
          data: {
            policyId,
            documentId: document.id,
            kind: 'TAG_DOCUMENT',
            status: 'PENDING',
            configVersion: config.configVersion,
          },
        });
        created.push({ id: job.id });
      }
      return created;
    });

    for (const job of jobs) {
      await this.enqueue(PAPERLESS_TAG_TAG_DOCUMENT_JOB, job.id, policyId);
    }

    return { scheduled: jobs.length };
  }

  // --- Durable enqueue -----------------------------------------------------

  /**
   * Pushes an existing outbox row to BullMQ. The job id equals the row id,
   * so a repeated dispatch is idempotent. Enqueue failures are logged and
   * swallowed: the row stays PENDING and the reconciliation re-dispatches
   * it, which keeps the DB change and the job creation consistent.
   */
  async enqueue(jobName: string, jobId: string, policyId: string): Promise<void> {
    try {
      await this.queue.add(
        jobName,
        { jobId, policyId },
        { jobId, removeOnComplete: true, removeOnFail: true },
      );
    } catch (err) {
      this.logger.warn(
        `Could not enqueue Paperless tag job ${jobId} (${jobName}) for policy ` +
          `${policyId}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
