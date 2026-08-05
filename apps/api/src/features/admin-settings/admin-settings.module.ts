import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminSettingsController } from './admin-settings.controller';
import { SettingsStoreService } from './settings-store.service';

@Module({
  imports: [IdentityModule],
  controllers: [AdminSettingsController],
  providers: [SettingsStoreService],
  exports: [SettingsStoreService],
})
export class AdminSettingsModule {}
