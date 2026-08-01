import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as os from 'os';
import { DatabaseService } from '../database';
import { AppConfigService } from '../config';

export interface WorkerHeartbeatStatus {
  /** 'up' = Heartbeat frisch, 'down' = Heartbeat veraltet, 'unknown' = noch nie gesehen */
  worker: 'up' | 'down' | 'unknown';
  lastSeenAt: string | null;
  workerId: string | null;
}

/**
 * AP-19: Worker-Heartbeat.
 *
 * Der Worker ruft `start()` beim Boot auf und schreibt danach regelmaessig
 * einen Heartbeat (Upsert auf `workerId`) in die Datenbank. Die API liest
 * ueber `getStatus()` den aktuellsten Heartbeat, um in GET /ready den
 * Worker-Zustand (up/down/unknown) auszuweisen.
 *
 * Wichtig: `start()` wird NUR im Worker-Prozess aufgerufen. Der API-Prozess
 * injiziert denselben Service (via WorkerHealthFoundationModule), nutzt
 * aber ausschliesslich `getStatus()` – dadurch kann die API niemals als
 * Worker "erscheinen".
 *
 * Es werden keine sensiblen Daten geschrieben/gelesen, nur Worker-Identitaet
 * (Hostname) und Zeitstempel. Ein Redis-Ausfall ist nicht relevant, da der
 * Heartbeat in PostgreSQL liegt; ein DB-Ausfall degradiert fail-soft
 * (Warnung, kein Prozessabbruch).
 */
@Injectable()
export class WorkerHeartbeatService implements OnModuleDestroy {
  /**
   * Retentionsfenster fuer verwaiste Heartbeat-Rows. Da `workerId` den
   * Prozess-PID enthaelt, bleibt nach jedem Worker-Neustart eine alte Row
   * liegen; `start()` raeumt solche Rows (aelter als dieses Fenster) auf.
   * Aktive Worker aktualisieren alle `intervalMs` (Default 15s) und sind
   * damit weit vor dem Fenster sicher vor dem Aufraeumen.
   */
  private static readonly PRUNE_RETENTION_MS = 60 * 60 * 1000; // 1 Stunde

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

  /** Startet das Heartbeat-Intervall. Nur im Worker-Prozess aufrufen. */
  start(): void {
    if (this.timer) return;
    void this.pruneStaleHeartbeats();
    void this.writeHeartbeat();
    this.timer = setInterval(() => void this.writeHeartbeat(), this.intervalMs);
    this.timer.unref?.();
  }

  /**
   * Loescht verwaiste Heartbeat-Rows (fail-soft: Fehler werden nur geloggt,
   * das Starten des Workers wird nie durch die Aufraeumung blockiert).
   */
  private async pruneStaleHeartbeats(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - WorkerHeartbeatService.PRUNE_RETENTION_MS);
      await this.db.workerHeartbeat.deleteMany({
        where: { lastSeenAt: { lt: cutoff } },
      });
    } catch (error) {
      this.logger.warn(
        `Heartbeat-Aufraeumung fehlgeschlagen: ${(error as Error).message}`,
      );
    }
  }

  /** Stoppt das Heartbeat-Intervall (z. B. beim Herunterfahren). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Schreibt einen Heartbeat (fail-soft: Fehler werden geloggt, werfen nie).
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
        `Worker-Heartbeat konnte nicht geschrieben werden: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Liest den aktuellsten Heartbeat und bewertet ihn gegen den konfigurierten
   * Timeout. Fail-soft: Bei DB-Fehlern wird 'unknown' geliefert.
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
