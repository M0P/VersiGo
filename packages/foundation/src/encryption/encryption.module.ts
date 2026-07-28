import { Global, Module } from '@nestjs/common';
import { ConfigFoundationModule } from '../config/config.module';
import { AesGcmEncryptionAdapter } from './aes-gcm-encryption.adapter';
import { ENCRYPTION_PORT } from './encryption.port';

@Global()
@Module({
  imports: [ConfigFoundationModule],
  providers: [
    {
      provide: ENCRYPTION_PORT,
      useClass: AesGcmEncryptionAdapter,
    },
  ],
  exports: [ENCRYPTION_PORT],
})
export class EncryptionModule {}
