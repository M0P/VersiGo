import { BullModule } from '@nestjs/bullmq';
import { AI_EXTRACTION_QUEUE } from './ai-assist.constants';

/**
 * BullMQ queue registration for AI extraction jobs.
 * Importiert in AiAssistModule.
 */
export const AiExtractionQueue = BullModule.registerQueue({
  name: AI_EXTRACTION_QUEUE,
});
