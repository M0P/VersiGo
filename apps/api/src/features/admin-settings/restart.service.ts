import { Injectable, Logger } from '@nestjs/common';
import { RestartCoordinatorService } from '@versigo/foundation';
import type { AuthenticatedUser } from '../identity/auth.service';

/**
 * Orchestriert den admin-ausgeloesten Neustart von API und Worker
 * (BugFix-06, Teil 3.4).
 *
 * Ablauf:
 * 1. Die Redis-Neustart-Anforderung wird mit Metadaten (wer, wann,
 *    optionaler Grund) hinterlegt – der Worker konsumiert sie ueber
 *    `watchRestartRequests` und beendet sich sauber.
 * 2. Die API beendet ihren eigenen Prozess nach einer kurzen
 *    Verzoegerung, damit die HTTP-Antwort den Client erreicht.
 *    Docker Compose (`restart: unless-stopped`) startet den Container
 *    mit den neuen Einstellungen neu (Restart-Kategorie-Settings werden
 *    beim Boot ueber `preloadRestartSettingsIntoEnv` aktiv).
 *
 * Sicherheit: Es werden ausschliesslich Nicht-Secrets geloggt bzw.
 * uebertragen (Benutzername, optionaler Grund). Bei nicht erreichbarem
 * Redis bleibt der lokale API-Neustart trotzdem moeglich (fail-soft).
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
        `Neustart-Anforderung konnte nicht in Redis gespeichert werden: ${
          error instanceof Error ? error.message : String(error)
        } – API wird trotzdem neu gestartet (Worker ggf. manuell).`,
      );
    }

    this.logger.log(`Neustart von api/worker durch '${user.username}' angefordert.`);

    // Verzoegerung, damit die HTTP-Antwort (200) den Client erreicht,
    // bevor der Prozess sauber beendet wird.
    setTimeout(() => process.exit(0), this.exitDelayMs);
  }

  // Verzoegerung bis zum Prozess-Exit (getrennt, damit Tests nicht auf
  // echte Timer angewiesen sind).
  private get exitDelayMs(): number {
    return 1500;
  }
}
