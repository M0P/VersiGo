import { Global, Module } from '@nestjs/common';
import { ConfigFoundationModule, SettingsFoundationModule } from '../config';
import { CapabilityFlagsService } from './capability-flags.service';

/**
 * Global capability lookup (AP-17/BugFix-05). Imports the
 * SettingsFoundation so that `isEnabled`/`snapshot` resolve through the
 * central resolver (UI > ENV > DEFAULT) and admin-UI values take effect.
 */
@Global()
@Module({
  imports: [ConfigFoundationModule, SettingsFoundationModule],
  providers: [CapabilityFlagsService],
  exports: [CapabilityFlagsService],
})
export class CapabilityFlagsModule {}
