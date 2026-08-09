import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config';

/**
 * Redis-backed restart coordinator (BugFix-06, part 3.4).
 *
 * Some settings (category "restart", e.g. OIDC bootstrap or
 * boot-activated secrets) are only read at process start. The admin
 * can trigger a controlled restart of API and worker via the UI:
 *
 * - The API sets a Redis request (`versigo:restart:request`) with
 *   metadata (who, when, optional reason) and then exits its own
 *   process in a controlled way. Docker Compose (`restart: unless-stopped`)
 *   restarts the container with the new settings.
 * - The worker polls the request periodically (`watchRestartRequests`)
 *   and also exits cleanly so it picks up the new settings on the
 *   next start.
 *
 * Security: only non-secrets are passed (username, reason). The request
 * carries a TTL so that an unconsumed restart (e.g. because the worker
 * was down) does not linger forever and trigger an unexpected restart
 * on the next start.
 */
export const RESTART_REQUEST_KEY = 'versigo:restart:request';

export type RestartTarget = 'api' | 'worker';

export type RestartRequestPayload = {
  /** ISO timestamp of the request. */
  requestedAt: string;
  /** Username of the requesting admin (not a secret). */
  requestedBy: string;
  /** Optional reason, e.g. "OIDC enabled". */
  reason?: string;
  /** Affected services. */
  services: RestartTarget[];
};

@Injectable()
export class RestartCoordinatorService implements OnModuleDestroy {
  private readonly logger = new Logger(RestartCoordinatorService.name);
  private readonly client: Redis;
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'end' || this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  /**
   * Stores a restart request in Redis (with TTL). Throws when Redis is
   * unreachable — the caller (API) catches the error and still exits its
   * process (local restart stays possible).
   */
  async requestRestart(payload: RestartRequestPayload): Promise<void> {
    await this.ensureConnected();
    await this.client.set(
      RESTART_REQUEST_KEY,
      JSON.stringify(payload),
      'EX',
      this.requestTtlSeconds,
    );
  }

  /**
   * Atomically fetches the restart request (read + delete) and returns
   * it, or `null` if none is pending. Called by the worker watcher.
   */
  async drainRestartRequest(): Promise<RestartRequestPayload | null> {
    await this.ensureConnected();
    const result = await this.client
      .multi()
      .get(RESTART_REQUEST_KEY)
      .del(RESTART_REQUEST_KEY)
      .exec();
    if (!result) return null;
    const raw = result[0]?.[1] as string | null;
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as RestartRequestPayload;
    } catch {
      this.logger.warn('Restart request is not valid JSON – ignoring.');
      return null;
    }
  }

  /**
   * Starts a periodic watcher for restart requests.
   * Used e.g. by the worker bootstrap: as soon as a request is pending,
   * the callback is invoked with the payload and the worker can exit
   * cleanly. Fail-soft: if the Redis access fails, only a warning is
   * logged and the next interval re-checks.
   */
  watchRestartRequests(
    onRequest: (payload: RestartRequestPayload) => void,
    intervalMs = 5_000,
  ): void {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => {
      this.drainRestartRequest()
        .then((payload) => {
          if (payload) onRequest(payload);
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Restart watcher: Redis access failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }, intervalMs);
    // The timer must not delay the process exit.
    this.watchTimer.unref?.();
  }

  get requestTtlSeconds(): number {
    return 300;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.client.disconnect();
  }
}
