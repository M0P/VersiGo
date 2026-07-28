import { Module } from '@nestjs/common';
import {
  ConfigFoundationModule,
  DatabaseModule,
  HealthFoundationModule,
  CapabilityFlagsModule,
  EncryptionModule,
  QueueFoundationModule,
} from '@insura/foundation';
import { AdminSettingsModule } from './features/admin-settings/admin-settings.module';
import { AiAssistModule } from './features/ai-assist/ai-assist.module';
import { AuditModule } from './features/audit/audit.module';
import { CostTrackingModule } from './features/cost-tracking/cost-tracking.module';
import { DocumentsModule } from './features/documents/documents.module';
import { IdentityModule } from './features/identity/identity.module';
import { NotificationsModule } from './features/notifications/notifications.module';
import { PolicyRegistryModule } from './features/policy-registry/policy-registry.module';
import { PortalConnectorsModule } from './features/portal-connectors/portal-connectors.module';

@Module({
  imports: [
    // Technische Foundations zuerst, global verfuegbar
    ConfigFoundationModule,
    DatabaseModule,
    EncryptionModule,
    CapabilityFlagsModule,
    QueueFoundationModule,
    HealthFoundationModule,

    // Fachliche Feature-Slices (weiterhin leer bis zu ihrem jeweiligen AP)
    IdentityModule,
    PolicyRegistryModule,
    DocumentsModule,
    CostTrackingModule,
    AiAssistModule,
    PortalConnectorsModule,
    AdminSettingsModule,
    AuditModule,
    NotificationsModule,
  ],
})
export class AppModule {}
