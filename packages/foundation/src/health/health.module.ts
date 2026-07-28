import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database';
import { CapabilityFlagsModule } from '../capabilities';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, CapabilityFlagsModule],
  controllers: [HealthController],
})
export class HealthFoundationModule {}
