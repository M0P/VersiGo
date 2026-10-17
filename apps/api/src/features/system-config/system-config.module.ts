import { Module } from '@nestjs/common';
import { SettingsFoundationModule } from '@versigo/foundation';
import { AdminSettingsModule } from '../admin-settings/admin-settings.module';
import { AiAssistModule } from '../ai-assist/ai-assist.module';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

/**
 * Central system configuration (AP-17): admin-UI endpoints for the
 * versioned settings catalog with UI > .env > default resolution,
 * encrypted persistence, audit and connectivity tests.
 *
 * AiAssistModule is imported for the connectivity-test cross-check of AI
 * keys against the runtime adapter (BugFix-22); there is no reverse
 * dependency, so no module cycle.
 */
@Module({
  imports: [AdminSettingsModule, SettingsFoundationModule, AiAssistModule],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
