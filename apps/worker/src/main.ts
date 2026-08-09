import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  preloadRestartSettingsIntoEnv,
  RestartCoordinatorService,
  WorkerHeartbeatService,
  WorkerLivenessService,
} from '@versigo/foundation';
import { WorkerModule } from './worker.module';

/**
 * Worker entry point. Boots a standalone application context,
 * no HTTP server. Initializes only the shared foundation
 * (config, database, queue infrastructure, capability flags) and
 * registers the domain job processors (AiExtractionProcessor).
 *
 * AP-17: Before the Nest bootstrap, restart settings (category
 * "restart") are written from the database into process.env so they
 * take effect from the first process start (fail-soft if the DB is
 * unreachable).
 *
 * AP-19: After the bootstrap the worker starts its heartbeat
 * (database upsert for the API's GET /ready) and a minimal liveness
 * server (WORKER_HEALTH_PORT, default 3100) for the compose
 * healthcheck.
 *
 * Note: createApplicationContext() – unlike the HTTP server
 * (`NestFactory.create`) – does not emit 'Nest application
 * successfully started'. The worker therefore logs its own ready
 * message after a successful bootstrap, which the compose smoke test
 * waits for among other things.
 */
async function bootstrap(): Promise<void> {
  await preloadRestartSettingsIntoEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // AP-19: health/readiness foundation of the worker
  app.get(WorkerHeartbeatService).start();
  app.get(WorkerLivenessService).start();

  // BugFix-06 (part 3.4): admin restart via the UI. The worker consumes
  // the Redis restart request and shuts down cleanly so that it picks up
  // the restart-category settings on the next start
  // (compose restart: unless-stopped).
  const restartCoordinator = app.get(RestartCoordinatorService);
  restartCoordinator.watchRestartRequests((payload) => {
    new Logger('RestartWatcher').log(
      `Restart requested by '${payload.requestedBy}'` +
        (payload.reason ? ` (reason: ${payload.reason})` : '') +
        ' – worker is shutting down cleanly.',
    );
    void app.close().then(() => process.exit(0));
  });

  new Logger('WorkerBootstrap').log(
    'Worker ready - queue infrastructure connected (PostgreSQL + Redis).',
  );

  process.on('SIGTERM', () => {
    void app.close();
  });
}

void bootstrap();
