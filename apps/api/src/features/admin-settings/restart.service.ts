import { Injectable, Logger } from '@nestjs/common';
import { RestartCoordinatorService } from '@versigo/foundation';
import type { AuthenticatedUser } from '../identity/auth.service';

/**
 * Orchestrates the admin-triggered restart of API and worker
 * (BugFix-06, part 3.4).
 *
 * Flow:
 * 1. The Redis restart request is stored with metadata (who, when,
 *    optional reason) – the worker consumes it via
 *    `watchRestartRequests` and shuts down cleanly.
 * 2. The API exits its own process after a short delay so the HTTP
 *    response reaches the client. Docker Compose
 *    (`restart: unless-stopped`) restarts the container with the new
 *    settings (restart-category settings are activated at boot via
 *    `preloadRestartSettingsIntoEnv`).
 *
 * Security: only non-secrets are logged or transferred (username,
 * optional reason). If Redis is unreachable, the local API restart
 * still remains possible (fail-soft).
 */
@Injectable()
export class RestartService {
  private readonly logger = new Logger(RestartService.name);

  constructor(private readonly coordinator: RestartCoordinatorService) {}

  async requestRestart(user: AuthenticatedUser, reason?: string): Promise<void> {
    try {
      await this.coordinator.requestRestart({
        requestedAt: new Date().toISOString(),
        requestedBy: user.username,
        reason: reason?.trim() ? reason.trim() : undefined,
        services: ['api', 'worker'],
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Restart request could not be stored in Redis: ${
          error instanceof Error ? error.message : String(error)
        } – API will restart anyway (worker possibly manually).`,
      );
    }

    this.logger.log(`Restart of api/worker requested by '${user.username}'.`);

    // Delay so the HTTP response (200) reaches the client before the
    // process shuts down cleanly.
    setTimeout(() => process.exit(0), this.exitDelayMs);
  }

  // Delay until process exit (separate so tests do not rely on real
  // timers).
  private get exitDelayMs(): number {
    return 1500;
  }
}
