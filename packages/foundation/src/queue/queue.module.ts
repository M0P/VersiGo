import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigFoundationModule } from '../config/config.module';
import { AppConfigService } from '../config';

/**
 * Shared queue infrastructure for API and worker based on BullMQ.
 * Contains no domain queues or job processors; feature slices register
 * their own queues via BullModule.registerQueue in their own module.
 */
@Module({
  imports: [
    ConfigFoundationModule,
    BullModule.forRootAsync({
      imports: [ConfigFoundationModule],
      useFactory: (config: AppConfigService) => ({
        connection: { url: config.redisUrl },
      }),
      inject: [AppConfigService],
    }),
  ],
  exports: [BullModule],
})
export class QueueFoundationModule {}
