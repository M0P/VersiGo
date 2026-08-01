import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { SettingsResolverService } from './settings-resolver.service';

/**
 * Stellt die zentrale Settings-Aufloesung (AP-17) fuer API und Worker
 * bereit. Der Resolver haengt an den globalen Database-/Encryption-
 * Foundations; die Module werden hier explizit importiert, um die
 * Abhaengigkeit sichtbar zu machen.
 */
@Global()
@Module({
  imports: [DatabaseModule, EncryptionModule],
  providers: [SettingsResolverService],
  exports: [SettingsResolverService],
})
export class SettingsFoundationModule {}
