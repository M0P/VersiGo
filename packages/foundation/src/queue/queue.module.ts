import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigFoundationModule } from '../config/config.module';
import { AppConfigService } from '../config';

/**
 * Gemeinsame Queue-Infrastruktur fuer API und Worker auf Basis von BullMQ.
 * Enthaelt keine fachlichen Queues oder Job-Prozessoren; Feature-Slices
 * registrieren eigene Queues ueber BullModule.registerQueue in ihrem
 * eigenen Modul.
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
