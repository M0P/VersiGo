import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SettingsFoundationModule } from '@versigo/foundation';
import { AiAssistController } from './ai-assist.controller';
import { AiAssistService } from './ai-assist.service';
import { AiProviderRegistry } from './ai-provider-registry';
import { OllamaAdapter } from './ollama.adapter';
import { OpenAiCompatAdapter } from './openai-compat.adapter';
import { NoOpAIAdapter } from './noop-ai.adapter';
import { AiExtractionQueue } from './ai-extraction.queue';
// AP-25: AiAssistService reads the OCR text of PAPERLESS_LINK documents.
import { PaperlessNgxModule } from '../paperless-ngx/paperless-ngx.module';

@Module({
  imports: [HttpModule, AiExtractionQueue, SettingsFoundationModule, PaperlessNgxModule],
  controllers: [AiAssistController],
  providers: [
    AiAssistService,
    AiProviderRegistry,
    OllamaAdapter,
    OpenAiCompatAdapter,
    NoOpAIAdapter,
  ],
  exports: [AiAssistService, AiExtractionQueue],
})
export class AiAssistModule {}
