import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database';
import { ConfigFoundationModule } from '../config';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerLivenessService } from './worker-liveness.service';

/**
 * AP-19: Worker-Health-Foundation.
 *
 * Stellt Heartbeat-Leser/-Schreiber und den Liveness-Server bereit.
 * - Worker-Prozess: ruft `WorkerHeartbeatService.start()` und
 *   `WorkerLivenessService.start()` im Bootstrap auf.
 * - API-Prozess: nutzt ausschliesslich `WorkerHeartbeatService.getStatus()`
 *   fuer GET /ready; Liveness-Server und Heartbeat-Interval laufen dort nie.
 */
@Module({
  imports: [DatabaseModule, ConfigFoundationModule],
  providers: [WorkerHeartbeatService, WorkerLivenessService],
  exports: [WorkerHeartbeatService, WorkerLivenessService],
})
export class WorkerHealthFoundationModule {}
