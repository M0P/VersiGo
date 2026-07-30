import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DatabaseService } from '../database';
import { RedisHealthService } from '../redis-health';
import { CapabilityFlagsService } from '../capabilities';

/**
 * Health-/Readiness-Endpunkte.
 * Gibt ausschliesslich boolesche Zustaende zurueck (up/down, enabled/disabled).
 * Es werden keine URLs, Secrets oder sonstigen Konfigurationswerte
 * offengelegt.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redisHealth: RedisHealthService,
    private readonly capabilities: CapabilityFlagsService,
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
    capabilities: Record<string, boolean>;
  }> {
    const [databaseHealthy, redisHealthy] = await Promise.all([
      this.db.isHealthy(),
      this.redisHealth.isHealthy(),
    ]);

    const allHealthy = databaseHealthy && redisHealthy;

    return {
      status: allHealthy ? 'ready' : 'degraded',
      database: databaseHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
      capabilities: this.capabilities.snapshot(),
    };
  }
}
