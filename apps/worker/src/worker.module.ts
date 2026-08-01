import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  ConfigFoundationModule,
  DatabaseModule,
  EncryptionModule,
  CapabilityFlagsModule,
  QueueFoundationModule,
  SettingsFoundationModule,
} from '@insura/foundation';
import { AiExtractionProcessor } from './ai-extraction.processor';

/**
 * Worker-Wurzelmodul. Bindet ausschliesslich technische Foundations ein.
 * Fachliche Job-Module werden von den jeweiligen Feature-Slices ergaenzt.
 */
@Module({
  imports: [
    ConfigFoundationModule,
    DatabaseModule,
    EncryptionModule,
    CapabilityFlagsModule,
    QueueFoundationModule,
    SettingsFoundationModule,

    // AI-Extraktions-Queue (muss mit API-Queue-Namen uebereinstimmen)
    BullModule.registerQueue({
      name: 'ai-extraction',
    }),
  ],
  providers: [AiExtractionProcessor],
})
export class WorkerModule {}
