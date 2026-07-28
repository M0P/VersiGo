import { Module } from '@nestjs/common';
import {
  ConfigFoundationModule,
  DatabaseModule,
  EncryptionModule,
  CapabilityFlagsModule,
  QueueFoundationModule,
} from '@insura/foundation';

/**
 * Worker-Wurzelmodul. Bindet ausschliesslich technische Foundations ein.
 * Fachliche Job-Module werden von den jeweiligen Feature-Slices in
 * spaeteren Arbeitspaketen ergaenzt (z. B. AiAssistJobsModule,
 * PortalSyncJobsModule), nicht hier zentral.
 */
@Module({
  imports: [
    ConfigFoundationModule,
    DatabaseModule,
    EncryptionModule,
    CapabilityFlagsModule,
    QueueFoundationModule,
  ],
})
export class WorkerModule {}
