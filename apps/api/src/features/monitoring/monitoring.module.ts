import { Module } from '@nestjs/common';
import { CapabilityFlagsModule, SettingsFoundationModule } from '@versigo/foundation';
import { AiAssistModule } from '../ai-assist/ai-assist.module';
import { PaperlessNgxModule } from '../paperless-ngx/paperless-ngx.module';
import { PortalConnectorsModule } from '../portal-connectors/portal-connectors.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

/**
 * Monitoring & health (AP-19). ADMIN routes only.
 * Imports AiAssistModule (queue + AiAssistService), PaperlessNgxModule
 * (PAPERLESS_ADAPTER) and PortalConnectorsModule (plugin health) for the
 * integration report.
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
