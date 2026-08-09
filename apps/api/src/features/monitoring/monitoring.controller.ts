import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { MonitoringService } from './monitoring.service';

/**
 * Admin monitoring API (AP-19). Global ADMINs only.
 *
 * - `GET /admin/monitoring/queues` – queue counters (no payloads)
 * - `GET /admin/monitoring/queues/failed` – failed jobs (redacted)
 * - `POST /admin/monitoring/queues/failed/:jobId/retry` – re-enqueue a job
 * - `GET /admin/monitoring/ai-jobs` – AI extraction job overview (DB)
 * - `GET /admin/monitoring/integrations` – integration status (no secrets)
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
