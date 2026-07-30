import { BullModule } from '@nestjs/bullmq';
import { AI_EXTRACTION_QUEUE } from './ai-assist.constants';

/**
 * BullMQ-Queue-Registrierung fuer AI-Extraktions-Jobs.
 * Importiert in AiAssistModule.
 */
export const AiExtractionQueue = BullModule.registerQueue({
  name: AI_EXTRACTION_QUEUE,
});
