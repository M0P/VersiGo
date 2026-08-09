import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { SettingsResolverService } from './settings-resolver.service';

/**
 * Provides the central settings resolution (AP-17) for API and worker.
 * The resolver depends on the global Database/Encryption foundations;
 * the modules are imported explicitly here to make the dependency visible.
 */
@Global()
@Module({
  imports: [DatabaseModule, EncryptionModule],
  providers: [SettingsResolverService],
  exports: [SettingsResolverService],
})
export class SettingsFoundationModule {}
