import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database';
import { RedisHealthModule } from '../redis-health';
import { CapabilityFlagsModule } from '../capabilities';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, RedisHealthModule, CapabilityFlagsModule],
  controllers: [HealthController],
})
export class HealthFoundationModule {}
