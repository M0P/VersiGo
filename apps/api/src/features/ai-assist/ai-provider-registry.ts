import { Injectable } from '@nestjs/common';
import { AppConfigService, CapabilityFlagsService } from '@insura/foundation';
import type { IAIAdapter } from '@insura/foundation';
import { OllamaAdapter } from './ollama.adapter';
import { OpenAiCompatAdapter } from './openai-compat.adapter';
import { NoOpAIAdapter } from './noop-ai.adapter';

/**
 * Registry, die den passenden AI-Adapter basierend auf der Konfiguration
 * auswaehlt. Wenn AI deaktiviert ist, wird der NoOp-Adapter verwendet.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly adapter: IAIAdapter;

  constructor(
    private readonly config: AppConfigService,
    private readonly capabilityFlags: CapabilityFlagsService,
    ollama: OllamaAdapter,
    openaiCompat: OpenAiCompatAdapter,
    private readonly noopAdapter: NoOpAIAdapter,
  ) {
    if (!this.capabilityFlags.isEnabled('ai')) {
      this.adapter = this.noopAdapter;
    } else {
      const provider = this.config.get('AI_PROVIDER') ?? 'ollama';
      switch (provider) {
        case 'openai-compat':
          this.adapter = openaiCompat;
          break;
        case 'ollama':
        default:
          this.adapter = ollama;
          break;
      }
    }
  }

  getAdapter(): IAIAdapter {
    return this.adapter;
  }
}
