import { Injectable } from '@nestjs/common';
import { SettingsResolverService } from '@insura/foundation';
import type { IAIAdapter } from '@insura/foundation';
import { OllamaAdapter } from './ollama.adapter';
import { OpenAiCompatAdapter } from './openai-compat.adapter';
import { NoOpAIAdapter } from './noop-ai.adapter';

/**
 * Registry, die den passenden AI-Adapter basierend auf der zentralen
 * Settings-Aufloesung auswaehlt (AP-17). AI_ENABLED und AI_PROVIDER
 * werden pro Aufruf ueber SettingsResolverService aufgeloest, sodass
 * Admin-UI-Aenderungen sofort wirken. Wenn AI deaktiviert ist, wird
 * der NoOp-Adapter verwendet.
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
