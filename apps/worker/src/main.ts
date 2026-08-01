import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  preloadRestartSettingsIntoEnv,
  WorkerHeartbeatService,
  WorkerLivenessService,
} from '@insura/foundation';
import { WorkerModule } from './worker.module';

/**
 * Worker-Startpunkt. Bootet einen Standalone-Application-Context,
 * kein HTTP-Server. Initialisiert nur die gemeinsame Foundation
 * (Config, Datenbank, Queue-Infrastruktur, Capability-Flags) und
 * registriert die fachlichen Job-Prozessoren (AiExtractionProcessor).
 *
 * AP-17: Vor dem Nest-Bootstrap werden Neustart-Settings (Kategorie
 * "restart") aus der Datenbank in process.env geschrieben, damit sie ab
 * dem ersten Prozessstart wirken (Fail-soft bei nicht erreichbarer DB).
 *
 * AP-19: Nach dem Bootstrap startet der Worker seinen Heartbeat
 * (Datenbank-Upsert fuer GET /ready der API) und einen minimalen
 * Liveness-Server (WORKER_HEALTH_PORT, Standard 3100) fuer den
 * Compose-Healthcheck.
 *
 * Hinweis: createApplicationContext() emittiert – anders als der
 * HTTP-Server (`NestFactory.create`) – kein 'Nest application
 * successfully started'. Der Worker loggt daher nach erfolgreichem
 * Bootstrap eine eigene Ready-Meldung, auf die u. a. der Compose-
 * Smoke-Test wartet.
 */
async function bootstrap(): Promise<void> {
  await preloadRestartSettingsIntoEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  // AP-19: Health-/Readiness-Grundlage des Workers
  app.get(WorkerHeartbeatService).start();
  app.get(WorkerLivenessService).start();

  new Logger('WorkerBootstrap').log(
    'Worker bereit - Queue-Infrastruktur verbunden (PostgreSQL + Redis).',
  );

  process.on('SIGTERM', () => {
    void app.close();
  });
}

void bootstrap();
