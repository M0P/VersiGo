import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as http from 'http';
import { AppConfigService } from '../config';

/**
 * AP-19: worker liveness server.
 *
 * The worker has no HTTP stack; for a Compose healthcheck and a minimal
 * per-component liveness endpoint this service starts a tiny HTTP server
 * on WORKER_HEALTH_PORT (default 3100). It only answers GET /health and
 * GET / with {"status":"ok"} — no configuration or sensitive values are
 * exposed. The port is NOT published externally (only internal
 * Compose network / container healthcheck).
 *
 * Important: `start()` is only called in the worker process. The API does
 * not use the service; the module is only imported there for the
 * heartbeat reader.
 */
@Injectable()
export class WorkerLivenessService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerLivenessService.name);
  private server?: http.Server;

  constructor(private readonly config: AppConfigService) {}

  /** Starts the liveness server. Only call in the worker process. */
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
      this.logger.error(`Worker liveness server error: ${err.message}`);
    });

    this.server.listen(port, '0.0.0.0', () => {
      this.logger.log(`Worker liveness server listening on port ${port}`);
    });
  }

  /** Stops the liveness server (e.g. on shutdown). */
  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Do not let open connections block the shutdown (healthcheck keepalive).
      server.closeAllConnections?.();
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}
