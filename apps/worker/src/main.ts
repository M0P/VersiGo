import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Worker-Startpunkt. Bootet einen Standalone-Application-Context,
 * kein HTTP-Server. Initialisiert nur die gemeinsame Foundation
 * (Config, Datenbank, Queue-Infrastruktur, Capability-Flags).
 * Fachliche Job-Prozessoren werden erst in spaeteren Arbeitspaketen
 * registriert.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  process.on('SIGTERM', () => {
    void app.close();
  });
}

void bootstrap();
