import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { AppConfigService } from '@insura/foundation';
import { OpenAiCompatAdapter } from '../openai-compat.adapter';
import { of } from 'rxjs';

function createMockConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  return {
    get: vi.fn((key: string) => {
      const defaults: Record<string, unknown> = {
        AI_OPENAI_COMPAT_BASE_URL: 'https://api.openai.com/v1',
        AI_OPENAI_COMPAT_API_KEY: 'sk-test',
        AI_OPENAI_COMPAT_MODEL: 'gpt-4o-mini',
        AI_EXTRACTION_TIMEOUT_MS: 60000,
      };
      return overrides[key] ?? defaults[key];
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

  it('hat providerKey "openai-compat"', () => {
    const config = createMockConfig();
    const adapter = new OpenAiCompatAdapter(httpService, config);
    expect(adapter.providerKey).toBe('openai-compat');
  });

  it('extractContractFacts gibt null bei leerer Konfiguration', async () => {
    const config = createMockConfig({
      AI_OPENAI_COMPAT_BASE_URL: '',
      AI_OPENAI_COMPAT_API_KEY: '',
    });
    const adapter = new OpenAiCompatAdapter(httpService, config);

    const result = await adapter.extractContractFacts(['test'], 'policy-1');
    expect(result).toBeNull();
  });

  it('extractContractFacts gibt null bei leeren Dokumenten', async () => {
    const config = createMockConfig();
    const adapter = new OpenAiCompatAdapter(httpService, config);

    const result = await adapter.extractContractFacts([], 'policy-1');
    expect(result).toBeNull();
  });

  it('verarbeitet erfolgreiche API-Antwort', async () => {
    const config = createMockConfig();
    const adapter = new OpenAiCompatAdapter(httpService, config);

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

  it('summarizeCoverage gibt null bei leerer Konfiguration', async () => {
    const config = createMockConfig({
      AI_OPENAI_COMPAT_BASE_URL: '',
      AI_OPENAI_COMPAT_API_KEY: '',
    });
    const adapter = new OpenAiCompatAdapter(httpService, config);

    const result = await adapter.summarizeCoverage(['test'], 'policy-1');
    expect(result).toBeNull();
  });

  it('healthCheck gibt false bei leerer Konfiguration', async () => {
    const config = createMockConfig({
      AI_OPENAI_COMPAT_BASE_URL: '',
      AI_OPENAI_COMPAT_API_KEY: '',
    });
    const adapter = new OpenAiCompatAdapter(httpService, config);

    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});
