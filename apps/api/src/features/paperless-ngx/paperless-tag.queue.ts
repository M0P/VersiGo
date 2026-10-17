import { BullModule } from '@nestjs/bullmq';
import { PAPERLESS_TAG_QUEUE } from './paperless-tag.constants';

/**
 * AP-22: BullMQ queue registration for Paperless tag jobs.
 * Imported in PaperlessNgxModule (API) and WorkerModule (worker).
 */
export const PaperlessTagQueue = BullModule.registerQueue({
  name: PAPERLESS_TAG_QUEUE,
});
