import { Module } from '@nestjs/common';
import { SettingsFoundationModule } from '@versigo/foundation';
import { AdminSettingsModule } from '../admin-settings/admin-settings.module';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

/**
 * Zentrale Systemkonfiguration (AP-17): Admin-UI-Endpunkte fuer den
 * versionierten Settings-Katalog mit UI > .env > Default-Aufloesung,
 * verschluesselter Persistenz, Audit und Connectivity-Tests.
 */
@Module({
  imports: [AdminSettingsModule, SettingsFoundationModule],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
