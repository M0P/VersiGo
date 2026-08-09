import { Module } from '@nestjs/common';
import { ConfigFoundationModule } from '../config/config.module';
import { RestartCoordinatorService } from './restart-coordinator.service';

/**
 * Foundation module for the Redis-backed restart coordinator
 * (BugFix-06, part 3.4). Globally importable via `RestartFoundationModule`;
 * used by the API (request + controlled process exit) and the
 * worker (watcher for the request).
 */
@Module({
  imports: [ConfigFoundationModule],
  providers: [RestartCoordinatorService],
  exports: [RestartCoordinatorService],
})
export class RestartFoundationModule {}
