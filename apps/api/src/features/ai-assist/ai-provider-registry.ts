import { Injectable } from '@nestjs/common';
import { SettingsResolverService } from '@versigo/foundation';
import type { IAIAdapter } from '@versigo/foundation';
import { OllamaAdapter } from './ollama.adapter';
import { OpenAiCompatAdapter } from './openai-compat.adapter';
import { NoOpAIAdapter } from './noop-ai.adapter';

/**
 * Registry that selects the matching AI adapter based on the central
 * settings resolution (AP-17). AI_ENABLED and AI_PROVIDER
 * are resolved per call via SettingsResolverService, so admin-UI
 * changes take effect immediately. When AI is disabled, the NoOp
 * adapter is used.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly adapters: Record<string, IAIAdapter>;

  constructor(
    private readonly settings: SettingsResolverService,
    ollama: OllamaAdapter,
    openaiCompat: OpenAiCompatAdapter,
    private readonly noopAdapter: NoOpAIAdapter,
  ) {
    this.adapters = { ollama, 'openai-compat': openaiCompat };
  }

  async getAdapter(): Promise<IAIAdapter> {
    const enabled = await this.settings.getEffectiveBoolean('AI_ENABLED');
    if (!enabled) {
      return this.noopAdapter;
    }

    const provider = (await this.settings.getEffectiveString('AI_PROVIDER')) ?? 'ollama';
    return this.adapters[provider] ?? this.noopAdapter;
  }
}
