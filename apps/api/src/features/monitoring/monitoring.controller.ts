import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { MonitoringService } from './monitoring.service';

/**
 * Admin-Monitoring-API (AP-19). Nur globale ADMINs.
 *
 * - `GET /admin/monitoring/queues` – Queue-Zaehler (keine Payloads)
 * - `GET /admin/monitoring/queues/failed` – fehlgeschlagene Jobs (redigiert)
 * - `POST /admin/monitoring/queues/failed/:jobId/retry` – Job erneut einreihen
 * - `GET /admin/monitoring/ai-jobs` – AI-Extraktions-Job-Uebersicht (DB)
 * - `GET /admin/monitoring/integrations` – Integrationsstatus (keine Secrets)
 */
@Controller('admin/monitoring')
@Roles(GlobalRole.ADMIN)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('queues')
  async queues(): Promise<ReturnType<MonitoringService['queueOverview']>> {
    return this.monitoring.queueOverview();
  }

  @Get('queues/failed')
  async failedJobs(): Promise<ReturnType<MonitoringService['listFailedJobs']>> {
    return this.monitoring.listFailedJobs();
  }

  @Post('queues/failed/:jobId/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retryFailedJob(@Param('jobId') jobId: string): Promise<void> {
    await this.monitoring.retryFailedJob(jobId);
  }

  @Get('ai-jobs')
  async aiJobs(): Promise<ReturnType<MonitoringService['aiJobs']>> {
    return this.monitoring.aiJobs();
  }

  @Get('integrations')
  async integrations(): Promise<ReturnType<MonitoringService['integrations']>> {
    return this.monitoring.integrations();
  }
}
