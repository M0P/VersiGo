import { Global, Module } from '@nestjs/common';
import { ConfigFoundationModule, SettingsFoundationModule } from '../config';
import { CapabilityFlagsService } from './capability-flags.service';

/**
 * Globale Capability-Auskunft (AP-17/BugFix-05). Importiert die
 * SettingsFoundation, damit `isEnabled`/`snapshot` ueber den zentralen
 * Resolver (UI > ENV > DEFAULT) aufloesen und Admin-UI-Werte wirksam werden.
 */
@Global()
@Module({
  imports: [ConfigFoundationModule, SettingsFoundationModule],
  providers: [CapabilityFlagsService],
  exports: [CapabilityFlagsService],
})
export class CapabilityFlagsModule {}
