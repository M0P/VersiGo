import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as http from 'http';
import { AppConfigService } from '../config';

/**
 * AP-19: Worker-Liveness-Server.
 *
 * Der Worker besitzt keinen HTTP-Stack; fuer einen Compose-Healthcheck und
 * einen minimalen Liveness-Endpunkt pro Komponente startet dieser Service
 * einen winzigen HTTP-Server auf WORKER_HEALTH_PORT (Standard 3100).
 * Er antwortet ausschliesslich auf GET /health und GET / mit
 * {"status":"ok"} – es werden keine Konfigurations- oder Sensiblen Werte
 * offengelegt. Der Port wird NICHT nach aussen publiziert (nur internes
 * Compose-Netzwerk / Container-Healthcheck).
 *
 * Wichtig: `start()` wird nur im Worker-Prozess aufgerufen. Die API nutzt
 * den Service nicht; das Modul wird dort lediglich fuer den Heartbeat-
 * Leser importiert.
 */
@Injectable()
export class WorkerLivenessService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerLivenessService.name);
  private server?: http.Server;

  constructor(private readonly config: AppConfigService) {}

  /** Startet den Liveness-Server. Nur im Worker-Prozess aufrufen. */
  start(): void {
    if (this.server) return;
    const port = this.config.get('WORKER_HEALTH_PORT');

    this.server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });

    this.server.on('error', (err) => {
      this.logger.error(`Worker-Liveness-Server Fehler: ${err.message}`);
    });

    this.server.listen(port, '0.0.0.0', () => {
      this.logger.log(`Worker-Liveness-Server lauscht auf Port ${port}`);
    });
  }

  /** Stoppt den Liveness-Server (z. B. beim Herunterfahren). */
  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Offene Verbindungen nicht blockieren lassen (Healthcheck-Keepalive).
      server.closeAllConnections?.();
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}
