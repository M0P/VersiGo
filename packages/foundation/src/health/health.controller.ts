import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DatabaseService } from '../database';
import { RedisHealthService } from '../redis-health';
import { CapabilityFlagsService } from '../capabilities';
import { WorkerHeartbeatService } from '../worker-health';

/**
 * Health-/Readiness-Endpunkte.
 * Gibt ausschliesslich boolesche Zustaende zurueck (up/down, enabled/disabled).
 * Es werden keine URLs, Secrets oder sonstigen Konfigurationswerte
 * offengelegt.
 *
 * AP-19: /ready weist zusaetzlich den Worker-Zustand aus (up/down/unknown,
 * basierend auf dem Datenbank-Heartbeat des Workers). Der Worker-Zustand ist
 * bewusst NUR Status-Information und fliesst nicht in das Gesamt-`status`-
 * Feld ein: Ein ausgefallener Worker beeintraechtigt die API selbst nicht,
 * wuerde aber sonst /ready dauerhaft auf 'degraded' setzen (und damit
 * Healthcheck/Orchestrierung irre-fuehren).
 */
@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redisHealth: RedisHealthService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly workerHeartbeat: WorkerHeartbeatService,
  ) {}

  @Public()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{
    status: 'ready' | 'degraded';
    database: 'up' | 'down';
    redis: 'up' | 'down';
    worker: 'up' | 'down' | 'unknown';
    capabilities: Record<string, boolean>;
  }> {
    const [databaseHealthy, redisHealthy, workerStatus] = await Promise.all([
      this.db.isHealthy(),
      this.redisHealth.isHealthy(),
      this.workerHeartbeat.getStatus(),
    ]);

    const allHealthy = databaseHealthy && redisHealthy;

    return {
      status: allHealthy ? 'ready' : 'degraded',
      database: databaseHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
      worker: workerStatus.worker,
      capabilities: this.capabilities.snapshot(),
    };
  }
}
