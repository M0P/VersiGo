import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config';

/**
 * Redis-gestuetzter Neustart-Koordinator (BugFix-06, Teil 3.4).
 *
 * Einige Einstellungen (Kategorie "restart", z. B. OIDC-Bootstrap oder
 * boot-aktivierte Secrets) werden nur beim Prozessstart gelesen. Der Admin
 * kann ueber die UI einen kontrollierten Neustart von API und Worker
 * ausloesen:
 *
 * - Die API setzt eine Redis-Anforderung (`versigo:restart:request`) mit
 *   Metadaten (wer, wann, optionaler Grund) und beendet danach ihren
 *   eigenen Prozess kontrolliert. Docker Compose (`restart: unless-stopped`)
 *   startet den Container mit den neuen Einstellungen neu.
 * - Der Worker pollt die Anforderung periodisch (`watchRestartRequests`)
 *   und beendet sich ebenfalls sauber, damit er die neuen Einstellungen
 *   beim naechsten Start uebernimmt.
 *
 * Sicherheit: Es werden ausschliesslich Nicht-Secrets uebergeben
 * (Benutzername, Grund). Die Anforderung ist mit einer TTL versehen,
 * damit ein nicht konsumierter Restart (z. B. weil der Worker gerade
 * ausfiel) nicht ewig anhaengt und beim naechsten Start einen
 * unerwarteten Neustart ausloest.
 */
export const RESTART_REQUEST_KEY = 'versigo:restart:request';

export type RestartTarget = 'api' | 'worker';

export type RestartRequestPayload = {
  /** ISO-Zeitpunkt der Anforderung. */
  requestedAt: string;
  /** Benutzername des anfordernden Admins (kein Secret). */
  requestedBy: string;
  /** Optionaler Grund, z. B. "OIDC aktiviert". */
  reason?: string;
  /** Betroffene Dienste. */
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
   * Hinterlegt eine Neustart-Anforderung in Redis (mit TTL). Wirft bei
   * nicht erreichbarem Redis – der Aufrufer (API) faengt den Fehler ab
   * und beendet seinen Prozess trotzdem (lokaler Neustart bleibt moeglich).
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
   * Holt die Neustart-Anforderung atomar ab (lies + loesche) und gibt
   * sie zurueck, oder `null`, wenn keine vorliegt. Wird vom Worker-
   * Watcher aufgerufen.
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
      this.logger.warn('Neustart-Anforderung ist kein gueltiges JSON – ignoriert.');
      return null;
    }
  }

  /**
   * Startet einen periodischen Watcher fuer Neustart-Anforderungen.
   * Wird z. B. vom Worker-Bootstrap genutzt: Sobald eine Anforderung
   * vorliegt, wird der Callback mit dem Payload aufgerufen und der
   * Worker kann sich sauber beenden. Fail-soft: Schlaegt der Redis-Zugriff
   * fehl, wird nur gewarnt und im naechsten Intervall erneut geprueft.
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
            `Restart-Watcher: Redis-Zugriff fehlgeschlagen: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }, intervalMs);
    // Der Timer soll den Prozess-Exit nicht verzoegern.
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
