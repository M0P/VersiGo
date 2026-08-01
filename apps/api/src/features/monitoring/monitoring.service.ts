import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService, CapabilityFlagsService, SettingsResolverService } from '@insura/foundation';
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
 * Fehlgeschlagene BullMQ-Jobs – bewusst REDIGIERT:
 * Job-Payloads (`job.data`, z. B. policyId/Dokument-Referenzen) und
 * Fehlermeldungen werden niemals vollstaendig zurueckgegeben. Die
 * `failedReason` wird auf 500 Zeichen gekuerzt.
 */
export interface FailedJobItem {
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  finishedOn: string | null;
}

/**
 * Admin-Monitoring (AP-19).
 *
 * Liefert Betriebszustaende der Queue-/Job-/Integrations-Schicht, ohne
 * sensitive Daten offenzulegen:
 * - BullMQ-Queue-Zaehler (keine Payloads)
 * - Fehlgeschlagene Jobs (redigiert, retry-faehig)
 * - AI-Extraktions-Jobs aus der DB (ohne errorMessage/extractedFieldsJson)
 * - Integrationsstatus (Paperless/AI/Storage/Portal-Connectoren/Portal-Links)
 *   – nur enabled/connected/Anzahl, niemals URLs, Tokens oder Zugangsdaten.
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

  /** Uebersicht aller registrierten Queues (nur Zaehler, keine Payloads). */
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

  /** Fehlgeschlagene Jobs aller registrierten Queues (redigiert). */
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

  /** Retry eines fehlgeschlagenen Jobs (kein Zugriff auf den Payload). */
  async retryFailedJob(jobId: string): Promise<{ retried: boolean }> {
    const job = await this.aiExtractionQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job nicht gefunden');
    }
    await job.retry();
    this.logger.log(`Fehlgeschlagener Job ${jobId} erneut eingereiht (Admin)`);
    return { retried: true };
  }

  /**
   * AI-Extraktions-Jobs aus der Datenbank. `errorMessage` und
   * `extractedFieldsJson` werden bewusst NICHT zurueckgegeben.
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
   * Integrationsstatus ohne sensitive Werte: nur enabled/connected und
   * Sync-Status-Zaehler. URLs, Tokens und Zugangsdaten werden nie geliefert.
   *
   * Portal-Connectoren (AP-18, seit dem Merge auf main real): Jedes
   * registrierte Plugin wird mit Verfuegbarkeit/Health aufgefuehrt
   * (getPluginHealth ist fail-soft). Die reason wird gekuerzt – sie ist
   * Entwickler-/Plugin-Text, enthaelt aber nie Zugangsdaten.
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
      storage: { enabled: this.capabilities.isEnabled('storage') },
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
