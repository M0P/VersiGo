import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  ConfigFoundationModule,
  DatabaseModule,
  EncryptionModule,
  CapabilityFlagsModule,
  QueueFoundationModule,
  RestartFoundationModule,
  SettingsFoundationModule,
  WorkerHealthFoundationModule,
} from '@versigo/foundation';
import { AiExtractionProcessor } from './ai-extraction.processor';

/**
 * Worker root module. Binds exclusively technical foundations.
 * Domain job modules are added by the respective feature slices.
 */
@Module({
  imports: [
    ConfigFoundationModule,
    DatabaseModule,
    EncryptionModule,
    CapabilityFlagsModule,
    QueueFoundationModule,
    RestartFoundationModule,
    SettingsFoundationModule,
    WorkerHealthFoundationModule,

    // AI extraction queue (must match the API queue name)
    BullModule.registerQueue({
      name: 'ai-extraction',
    }),
  ],
  providers: [AiExtractionProcessor],
})
export class WorkerModule {}
