import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database';
import { ConfigFoundationModule } from '../config';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerLivenessService } from './worker-liveness.service';

/**
 * AP-19: worker health foundation.
 *
 * Provides the heartbeat reader/writer and the liveness server.
 * - Worker process: calls `WorkerHeartbeatService.start()` and
 *   `WorkerLivenessService.start()` during bootstrap.
 * - API process: uses only `WorkerHeartbeatService.getStatus()`
 *   for GET /ready; liveness server and heartbeat interval never run there.
 */
@Module({
  imports: [DatabaseModule, ConfigFoundationModule],
  providers: [WorkerHeartbeatService, WorkerLivenessService],
  exports: [WorkerHeartbeatService, WorkerLivenessService],
})
export class WorkerHealthFoundationModule {}
