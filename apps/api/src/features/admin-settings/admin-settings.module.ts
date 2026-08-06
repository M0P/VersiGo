import { Module } from '@nestjs/common';
import { RestartFoundationModule, SettingsFoundationModule } from '@versigo/foundation';
import { IdentityModule } from '../identity/identity.module';
import { AdminSettingsController } from './admin-settings.controller';
import { SettingsStoreService } from './settings-store.service';
import { RestartService } from './restart.service';

@Module({
  imports: [IdentityModule, SettingsFoundationModule, RestartFoundationModule],
  controllers: [AdminSettingsController],
  providers: [SettingsStoreService, RestartService],
  exports: [SettingsStoreService],
})
export class AdminSettingsModule {}
