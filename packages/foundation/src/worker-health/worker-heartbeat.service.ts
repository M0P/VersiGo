import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as os from 'os';
import { DatabaseService } from '../database';
import { AppConfigService } from '../config';

export interface WorkerHeartbeatStatus {
  /** 'up' = fresh heartbeat, 'down' = stale heartbeat, 'unknown' = never seen */
  worker: 'up' | 'down' | 'unknown';
  lastSeenAt: string | null;
  workerId: string | null;
}

/**
 * AP-19: worker heartbeat.
 *
 * The worker calls `start()` during boot and then periodically writes
 * a heartbeat (upsert on `workerId`) into the database. The API reads
 * the most recent heartbeat via `getStatus()` to report the worker
 * state (up/down/unknown) in GET /ready.
 *
 * Important: `start()` is only called in the worker process. The API
 * process injects the same service (via WorkerHealthFoundationModule)
 * but only uses `getStatus()` — so the API can never "appear" as a worker.
 *
 * No sensitive data is written/read, only the worker identity (hostname)
 * and timestamps. A Redis outage is irrelevant because the heartbeat
 * lives in PostgreSQL; a DB outage degrades fail-soft (warning, no
 * process abort).
 */
@Injectable()
export class WorkerHeartbeatService implements OnModuleDestroy {
  /**
   * Retention window for orphaned heartbeat rows. Because `workerId`
   * contains the process PID, an old row remains after every worker
   * restart; `start()` prunes such rows (older than this window).
   * Active workers update every `intervalMs` (default 15s) and are
   * therefore safely ahead of the window before pruning.
   */
  private static readonly PRUNE_RETENTION_MS = 60 * 60 * 1000; // 1 hour

  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private timer?: NodeJS.Timeout;
  private readonly workerId: string;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly db: DatabaseService,
    config: AppConfigService,
  ) {
    this.workerId = `${os.hostname()}:${process.pid}`;
    this.intervalMs = config.get('WORKER_HEARTBEAT_INTERVAL_MS');
    this.timeoutMs = config.get('WORKER_HEARTBEAT_TIMEOUT_MS');
  }

  /** Starts the heartbeat interval. Only call in the worker process. */
  start(): void {
    if (this.timer) return;
    void this.pruneStaleHeartbeats();
    void this.writeHeartbeat();
    this.timer = setInterval(() => void this.writeHeartbeat(), this.intervalMs);
    this.timer.unref?.();
  }

  /**
   * Deletes orphaned heartbeat rows (fail-soft: errors are only logged,
   * the worker startup is never blocked by the cleanup).
   */
  private async pruneStaleHeartbeats(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - WorkerHeartbeatService.PRUNE_RETENTION_MS);
      await this.db.workerHeartbeat.deleteMany({
        where: { lastSeenAt: { lt: cutoff } },
      });
    } catch (error) {
      this.logger.warn(
        `Heartbeat cleanup failed: ${(error as Error).message}`,
      );
    }
  }

  /** Stops the heartbeat interval (e.g. on shutdown). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Writes a heartbeat (fail-soft: errors are logged, never thrown).
   */
  async writeHeartbeat(): Promise<void> {
    try {
      const now = new Date();
      await this.db.workerHeartbeat.upsert({
        where: { workerId: this.workerId },
        create: {
          workerId: this.workerId,
          instanceLabel: os.hostname(),
          startedAt: now,
          lastSeenAt: now,
        },
        update: { lastSeenAt: now },
      });
    } catch (error) {
      this.logger.warn(
        `Worker heartbeat could not be written: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Reads the most recent heartbeat and evaluates it against the configured
   * timeout. Fail-soft: 'unknown' is returned on DB errors.
   */
  async getStatus(): Promise<WorkerHeartbeatStatus> {
    try {
      const latest = await this.db.workerHeartbeat.findFirst({
        orderBy: { lastSeenAt: 'desc' },
      });
      if (!latest) {
        return { worker: 'unknown', lastSeenAt: null, workerId: null };
      }
      const staleMs = Date.now() - latest.lastSeenAt.getTime();
      if (staleMs > this.timeoutMs) {
        return {
          worker: 'down',
          lastSeenAt: latest.lastSeenAt.toISOString(),
          workerId: latest.workerId,
        };
      }
      return {
        worker: 'up',
        lastSeenAt: latest.lastSeenAt.toISOString(),
        workerId: latest.workerId,
      };
    } catch {
      return { worker: 'unknown', lastSeenAt: null, workerId: null };
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
  }
}
