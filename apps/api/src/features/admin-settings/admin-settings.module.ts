import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminSettingsController } from './admin-settings.controller';
import { SettingsStoreService } from './settings-store.service';
import { FeatureFlagsService } from './feature-flags.service';

@Module({
  imports: [IdentityModule],
  controllers: [AdminSettingsController],
  providers: [SettingsStoreService, FeatureFlagsService],
  exports: [SettingsStoreService, FeatureFlagsService],
})
export class AdminSettingsModule {}
