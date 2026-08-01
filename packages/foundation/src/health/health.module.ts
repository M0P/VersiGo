import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database';
import { RedisHealthModule } from '../redis-health';
import { CapabilityFlagsModule } from '../capabilities';
import { WorkerHealthFoundationModule } from '../worker-health';
import { HealthController } from './health.controller';

@Module({
  imports: [
    DatabaseModule,
    RedisHealthModule,
    CapabilityFlagsModule,
    WorkerHealthFoundationModule,
  ],
  controllers: [HealthController],
})
export class HealthFoundationModule {}
