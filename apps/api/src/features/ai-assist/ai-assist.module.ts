import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiAssistController } from './ai-assist.controller';
import { AiAssistService } from './ai-assist.service';
import { AiProviderRegistry } from './ai-provider-registry';
import { OllamaAdapter } from './ollama.adapter';
import { OpenAiCompatAdapter } from './openai-compat.adapter';
import { NoOpAIAdapter } from './noop-ai.adapter';
import { AiExtractionQueue } from './ai-extraction.queue';

@Module({
  imports: [HttpModule, AiExtractionQueue],
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
