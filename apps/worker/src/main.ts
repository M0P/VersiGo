import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Worker-Startpunkt. Bootet einen Standalone-Application-Context,
 * kein HTTP-Server. Initialisiert nur die gemeinsame Foundation
 * (Config, Datenbank, Queue-Infrastruktur, Capability-Flags) und
 * registriert die fachlichen Job-Prozessoren (AiExtractionProcessor).
 *
 * Hinweis: createApplicationContext() emittiert – anders als der
 * HTTP-Server (`NestFactory.create`) – kein 'Nest application
 * successfully started'. Der Worker loggt daher nach erfolgreichem
 * Bootstrap eine eigene Ready-Meldung, auf die u. a. der Compose-
 * Smoke-Test wartet.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  new Logger('WorkerBootstrap').log(
    'Worker bereit - Queue-Infrastruktur verbunden (PostgreSQL + Redis).',
  );

  process.on('SIGTERM', () => {
    void app.close();
  });
}

void bootstrap();
