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
import { PaperlessTagProcessor } from './paperless-tag.processor';
import { PaperlessTagClient } from './paperless-tag.client';
import { PAPERLESS_TAG_QUEUE } from './paperless-tag.constants';

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

    // Paperless tag sync queue (must match the API queue name,
    // see paperless-tag.constants.ts)
    BullModule.registerQueue({
      name: PAPERLESS_TAG_QUEUE,
    }),
  ],
  providers: [AiExtractionProcessor, PaperlessTagProcessor, PaperlessTagClient],
})
export class WorkerModule {}
