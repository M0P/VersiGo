import { Global, Module } from '@nestjs/common';
import { ConfigFoundationModule } from '../config/config.module';
import { RedisHealthService } from './redis-health.service';

@Global()
@Module({
  imports: [ConfigFoundationModule],
  providers: [RedisHealthService],
  exports: [RedisHealthService],
})
export class RedisHealthModule {}
