import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database';
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
    private readonly capabilities: CapabilityFlagsService,
  ) {}

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{
    status: 'ready' | 'degraded';
    database: 'up' | 'down';
    capabilities: Record<string, boolean>;
  }> {
    const databaseHealthy = await this.db.isHealthy();

    return {
      status: databaseHealthy ? 'ready' : 'degraded',
      database: databaseHealthy ? 'up' : 'down',
      capabilities: this.capabilities.snapshot(),
    };
  }
}
