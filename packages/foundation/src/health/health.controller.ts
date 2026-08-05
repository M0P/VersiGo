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

    // BugFix-05: snapshot ist seit der Resolver-Umstellung asynchron
    // (SettingsResolverService, UI > ENV > DEFAULT) und greift dabei auf die
    // Datenbank zu. Fail-soft wie die uebrigen Checks: Faellt die DB aus,
    // duerfen die Capabilities den Readiness-Request nicht zu HTTP 500 machen –
    // /ready soll in dem Fall weiterhin mit status 'degraded' antworten (die
    // DB ist ohnehin bereits als 'down' ausgewiesen) und ein leeres
    // Capabilities-Objekt liefern statt zu werfen.
    let capabilities: Record<string, boolean> = {};
    try {
      capabilities = await this.capabilities.snapshot();
    } catch {
      // DB-Ausfall: Capability-Flags nicht aufloesbar, leer melden.
      // Der Gesamt-Status wird durch databaseHealthy unten bereits
      // auf 'degraded' gesetzt.
    }

    const allHealthy = databaseHealthy && redisHealthy;

    return {
      status: allHealthy ? 'ready' : 'degraded',
      database: databaseHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
      worker: workerStatus.worker,
      capabilities,
    };
  }
}
