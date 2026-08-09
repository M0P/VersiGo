import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import type { SettingsResolverService } from '@versigo/foundation';
import { OpenAiCompatAdapter } from '../openai-compat.adapter';
import { of } from 'rxjs';

function createMockSettings(overrides: Record<string, string | number | boolean> = {}): SettingsResolverService {
  return {
    getEffectiveString: vi.fn(async (key: string) => {
      const defaults: Record<string, string> = {
        AI_OPENAI_COMPAT_BASE_URL: 'https://api.openai.com/v1',
        AI_OPENAI_COMPAT_API_KEY: 'sk-test',
        AI_OPENAI_COMPAT_MODEL: 'gpt-4o-mini',
      };
      const value = overrides[key] ?? defaults[key];
      return typeof value === 'string' ? value : String(value);
    }),
    getEffectiveBoolean: vi.fn(async (key: string) => {
      const defaults: Record<string, boolean> = {
        AI_ENABLED: true,
      };
      const value = overrides[key] ?? defaults[key];
      return typeof value === 'boolean' ? value : value === 'true';
    }),
    getEffectiveNumber: vi.fn(async (key: string) => {
      const defaults: Record<string, number> = {
        AI_EXTRACTION_TIMEOUT_MS: 60000,
      };
      const value = overrides[key] ?? defaults[key];
      return typeof value === 'number' ? value : Number(value);
    }),
  } as never;
}

describe('OpenAiCompatAdapter', () => {
  let httpService: HttpService;

  beforeEach(() => {
    httpService = {
      post: vi.fn(),
      get: vi.fn(),
    } as never;
  });

  it('has providerKey "openai-compat"', () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);
    expect(adapter.providerKey).toBe('openai-compat');
  });

  it('extractContractFacts returns null for an empty configuration', async () => {
    const settings = createMockSettings({
      AI_OPENAI_COMPAT_BASE_URL: '',
      AI_OPENAI_COMPAT_API_KEY: '',
    });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    const result = await adapter.extractContractFacts(['test'], 'policy-1');
    expect(result).toBeNull();
  });

  it('extractContractFacts returns null for empty documents', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    const result = await adapter.extractContractFacts([], 'policy-1');
    expect(result).toBeNull();
  });

  it('verarbeitet erfolgreiche API-Antwort', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    const mockResponse = {
      id: 'chat-1',
      model: 'gpt-4o-mini',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              insurerName: 'Test AG',
              contractNumber: 'POL-123',
              confidence: {
                insurerName: 0.98,
                contractNumber: 0.95,
              },
            }),
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.mocked(httpService.post).mockReturnValue(
      of({ data: mockResponse }) as never,
    );

    const result = await adapter.extractContractFacts(['Test content'], 'policy-1');

    expect(result).not.toBeNull();
    expect(result!.fields.insurerName).toBe('Test AG');
    expect(result!.fields.contractNumber).toBe('POL-123');
    expect(result!.confidence.insurerName).toBe(0.98);
    expect(result!.model).toBe('gpt-4o-mini');
  });

  it('summarizeCoverage returns null for an empty configuration', async () => {
    const settings = createMockSettings({
      AI_OPENAI_COMPAT_BASE_URL: '',
      AI_OPENAI_COMPAT_API_KEY: '',
    });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    const result = await adapter.summarizeCoverage(['test'], 'policy-1');
    expect(result).toBeNull();
  });

  it('healthCheck returns false for an empty configuration', async () => {
    const settings = createMockSettings({
      AI_OPENAI_COMPAT_BASE_URL: '',
      AI_OPENAI_COMPAT_API_KEY: '',
    });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});
