import { Module } from '@nestjs/common';
import {
  ConfigFoundationModule,
  DatabaseModule,
  HealthFoundationModule,
  CapabilityFlagsModule,
  EncryptionModule,
  QueueFoundationModule,
} from '@versigo/foundation';
import { AdminSettingsModule } from './features/admin-settings/admin-settings.module';
import { AiAssistModule } from './features/ai-assist/ai-assist.module';
import { AuditModule } from './features/audit/audit.module';
import { CostTrackingModule } from './features/cost-tracking/cost-tracking.module';
import { DocumentsModule } from './features/documents/documents.module';
import { FamilySharingModule } from './features/family-sharing/family-sharing.module';
import { IdentityModule } from './features/identity/identity.module';
import { LanguageModule } from './features/language/language.module';
import { MonitoringModule } from './features/monitoring/monitoring.module';
import { NotificationsModule } from './features/notifications/notifications.module';
import { PaperlessNgxModule } from './features/paperless-ngx/paperless-ngx.module';
import { PolicyRegistryModule } from './features/policy-registry/policy-registry.module';
import { PortalConnectorsModule } from './features/portal-connectors/portal-connectors.module';
import { PrivacyModule } from './features/privacy/privacy.module';
import { ProfileModule } from './features/profile/profile.module';
import { SystemConfigModule } from './features/system-config/system-config.module';
import { UserPreferencesModule } from './features/user-preferences/user-preferences.module';

@Module({
  imports: [
    // Technische Foundations zuerst, global verfuegbar
    ConfigFoundationModule,
    DatabaseModule,
    EncryptionModule,
    CapabilityFlagsModule,
    QueueFoundationModule,
    HealthFoundationModule,

    // Fachliche Feature-Slices
    IdentityModule,
    PolicyRegistryModule,
    DocumentsModule,
    CostTrackingModule,
    FamilySharingModule,
    AiAssistModule,
    PortalConnectorsModule,
    AdminSettingsModule,
    AuditModule,
    MonitoringModule,
    PrivacyModule,
    NotificationsModule,
    PaperlessNgxModule,
    UserPreferencesModule,
    SystemConfigModule,
    ProfileModule,
    LanguageModule,
  ],
})
export class AppModule {}
