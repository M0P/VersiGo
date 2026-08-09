import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService, CapabilityFlagsService, SettingsResolverService } from '@versigo/foundation';
import { AI_EXTRACTION_QUEUE } from '../ai-assist/ai-assist.constants';
import { AiAssistService } from '../ai-assist/ai-assist.service';
import { PAPERLESS_ADAPTER, IPaperlessAdapter } from '../paperless-ngx/paperless-ngx.interface';
import { PortalConnectorService } from '../portal-connectors/portal-connector.service';

export interface QueueOverviewItem {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

/**
 * Failed BullMQ jobs – deliberately REDACTED: job payloads (`job.data`,
 * e.g. policyId/document references) and error messages are never
 * returned in full. The `failedReason` is truncated to 500 characters.
 */
export interface FailedJobItem {
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  finishedOn: string | null;
}

/**
 * Admin monitoring (AP-19).
 *
 * Reports the operational state of the queue/job/integration layer
 * without exposing sensitive data:
 * - BullMQ queue counters (no payloads)
 * - Failed jobs (redacted, retryable)
 * - AI extraction jobs from the DB (without errorMessage/extractedFieldsJson)
 * - Integration status (Paperless/AI/Storage/portal connectors/portal links)
 *   – only enabled/connected/counts, never URLs, tokens or credentials.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(AI_EXTRACTION_QUEUE) private readonly aiExtractionQueue: Queue,
    private readonly aiAssist: AiAssistService,
    @Inject(PAPERLESS_ADAPTER) private readonly paperless: IPaperlessAdapter,
    private readonly settings: SettingsResolverService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly portalConnectors: PortalConnectorService,
  ) {}

  /** Overview of all registered queues (counters only, no payloads). */
  async queueOverview(): Promise<QueueOverviewItem[]> {
    const counts = await this.aiExtractionQueue.getJobCounts();
    return [
      {
        queue: 'ai-extraction',
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      },
    ];
  }

  /** Failed jobs of all registered queues (redacted). */
  async listFailedJobs(): Promise<FailedJobItem[]> {
    const failed = await this.aiExtractionQueue.getFailed(0, 20);
    return failed.map((job) => ({
      id: String(job.id),
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ? job.failedReason.slice(0, 500) : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    }));
  }

  /** Retries a failed job (no access to the payload). */
  async retryFailedJob(jobId: string): Promise<{ retried: boolean }> {
    const job = await this.aiExtractionQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }
    await job.retry();
    this.logger.log(`Failed job ${jobId} re-enqueued (Admin)`);
    return { retried: true };
  }

  /**
   * AI extraction jobs from the database. `errorMessage` and
   * `extractedFieldsJson` are deliberately NOT returned.
   */
  async aiJobs(): Promise<{
    statusCounts: Record<string, number>;
    recent: Array<{
      id: string;
      policyId: string;
      providerKey: string;
      model: string | null;
      status: string;
      retryCount: number;
      createdAt: string;
      updatedAt: string;
      completedAt: string | null;
    }>;
  }> {
    const [statusGroups, recent] = await Promise.all([
      this.db.aiExtractionJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.aiExtractionJob.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          policyId: true,
          providerKey: true,
          model: true,
          status: true,
          retryCount: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
        },
      }),
    ]);

    return {
      statusCounts: Object.fromEntries(
        statusGroups.map((group) => [group.status, group._count._all]),
      ),
      recent: recent.map((job) => ({
        id: job.id,
        policyId: job.policyId,
        providerKey: job.providerKey,
        model: job.model,
        status: job.status,
        retryCount: job.retryCount,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Integration status without sensitive values: only enabled/connected
   * and sync-status counters. URLs, tokens and credentials are never
   * delivered.
   *
   * Portal connectors (AP-18, real since the merge to main): every
   * registered plugin is listed with availability/health
   * (getPluginHealth is fail-soft). The reason is truncated – it is
   * developer/plugin text but never contains credentials.
   */
  async integrations(): Promise<{
    ai: { enabled: boolean; provider: string; connected: boolean };
    paperless: { enabled: boolean; connected: boolean };
    portalAccountLinks: { bySyncStatus: Record<string, number> };
    storage: { enabled: boolean };
    portalConnectors: Array<{
      key: string;
      displayName: string;
      experimental: boolean;
      available: boolean;
      healthy: boolean;
      reason: string | null;
      checkedAt: string;
    }>;
  }> {
    const [aiStatus, portalGroups] = await Promise.all([
      this.aiAssist.healthCheck(),
      this.db.portalAccountLink.groupBy({ by: ['syncStatus'], _count: { _all: true } }),
    ]);

    const connectorPlugins = this.portalConnectors.listPlugins();
    const connectorHealth = await Promise.all(
      connectorPlugins.map((plugin) => this.portalConnectors.getPluginHealth(plugin.key)),
    );

    const paperlessEnabled =
      (await this.settings.getEffectiveBoolean('PAPERLESS_ENABLED')) ?? false;
    const paperlessConnected = paperlessEnabled ? await this.paperless.healthCheck() : false;

    return {
      ai: {
        enabled: aiStatus.provider !== 'none',
        provider: aiStatus.provider,
        connected: aiStatus.connected,
      },
      paperless: { enabled: paperlessEnabled, connected: paperlessConnected },
      portalAccountLinks: {
        bySyncStatus: Object.fromEntries(
          portalGroups.map((group) => [group.syncStatus, group._count._all]),
        ),
      },
      storage: { enabled: await this.capabilities.isEnabled('storage') },
      portalConnectors: connectorPlugins.map((plugin, index) => {
        const health = connectorHealth[index];
        return {
          key: plugin.key,
          displayName: plugin.displayName,
          experimental: plugin.experimental,
          available: plugin.available,
          healthy: health?.healthy ?? false,
          reason: health?.reason ? health.reason.slice(0, 200) : null,
          checkedAt: health?.checkedAt ?? new Date().toISOString(),
        };
      }),
    };
  }
}
