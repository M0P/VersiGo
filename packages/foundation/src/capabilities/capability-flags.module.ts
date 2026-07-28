import { Global, Module } from '@nestjs/common';
import { ConfigFoundationModule } from '../config/config.module';
import { CapabilityFlagsService } from './capability-flags.service';

@Global()
@Module({
  imports: [ConfigFoundationModule],
  providers: [CapabilityFlagsService],
  exports: [CapabilityFlagsService],
})
export class CapabilityFlagsModule {}
