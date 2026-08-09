import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DatabaseService } from '../database';
import { RedisHealthService } from '../redis-health';
import { CapabilityFlagsService } from '../capabilities';
import { WorkerHeartbeatService } from '../worker-health';
import { AppConfigService } from '../config';

/**
 * Health/readiness endpoints.
 * Returns only boolean states (up/down, enabled/disabled).
 * No URLs, secrets or other configuration values are exposed.
 *
 * AP-19: /ready additionally reports the worker state (up/down/unknown,
 * based on the worker's database heartbeat). The worker state is
 * deliberately ONLY status information and does not feed into the overall
 * `status` field: a failed worker does not affect the API itself, but
 * would otherwise keep /ready at 'degraded' forever (and thus mislead
 * healthchecks/orchestration).
 */
@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redisHealth: RedisHealthService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly workerHeartbeat: WorkerHeartbeatService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * BugFix-11 (R7): the runtime application version (APP_VERSION) is a
   * public, harmless value and is exposed on both endpoints; when the
   * variable is unset it reports 'unknown'. No secrets are ever exposed.
   */
  private get version(): string {
    return this.config.appVersion ?? 'unknown';
  }

  @Public()
  @Get('health')
  health(): { status: 'ok'; version: string } {
    return { status: 'ok', version: this.version };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{
    status: 'ready' | 'degraded';
    version: string;
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

    // BugFix-05: snapshot is async since the resolver migration
    // (SettingsResolverService, UI > ENV > DEFAULT) and accesses the
    // database. Fail-soft like the other checks: if the DB is down, the
    // capabilities must not turn the readiness request into HTTP 500 —
    // /ready should still respond with status 'degraded' in that case (the
    // DB is already reported as 'down' anyway) and return an empty
    // capabilities object instead of throwing.
    let capabilities: Record<string, boolean> = {};
    try {
      capabilities = await this.capabilities.snapshot();
    } catch {
      // DB outage: capability flags not resolvable, report empty.
      // The overall status is already set to 'degraded' by databaseHealthy below.
    }

    const allHealthy = databaseHealthy && redisHealthy;

    return {
      status: allHealthy ? 'ready' : 'degraded',
      version: this.version,
      database: databaseHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
      worker: workerStatus.worker,
      capabilities,
    };
  }
}
