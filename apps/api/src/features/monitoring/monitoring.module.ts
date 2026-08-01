import { Module } from '@nestjs/common';
import { CapabilityFlagsModule, SettingsFoundationModule } from '@insura/foundation';
import { AiAssistModule } from '../ai-assist/ai-assist.module';
import { PaperlessNgxModule } from '../paperless-ngx/paperless-ngx.module';
import { PortalConnectorsModule } from '../portal-connectors/portal-connectors.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

/**
 * Monitoring & Health (AP-19). Nur ADMIN-Routen.
 * Importiert AiAssistModule (Queue + AiAssistService), PaperlessNgxModule
 * (PAPERLESS_ADAPTER) und PortalConnectorsModule (Plugin-Health) fuer die
 * Integrationsauskunft.
 */
@Module({
  imports: [
    AiAssistModule,
    PaperlessNgxModule,
    PortalConnectorsModule,
    SettingsFoundationModule,
    CapabilityFlagsModule,
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
