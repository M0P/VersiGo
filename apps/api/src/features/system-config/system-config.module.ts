import { Module } from '@nestjs/common';
import { SettingsFoundationModule } from '@versigo/foundation';
import { AdminSettingsModule } from '../admin-settings/admin-settings.module';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

/**
 * Central system configuration (AP-17): admin-UI endpoints for the
 * versioned settings catalog with UI > .env > default resolution,
 * encrypted persistence, audit and connectivity tests.
 */
@Module({
  imports: [AdminSettingsModule, SettingsFoundationModule],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
