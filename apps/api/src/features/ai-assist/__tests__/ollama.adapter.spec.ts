import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { AppConfigService } from '@insura/foundation';
import { OllamaAdapter } from '../ollama.adapter';
import { of } from 'rxjs';

function createMockConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  return {
    get: vi.fn((key: string) => {
      const defaults: Record<string, unknown> = {
        AI_OLLAMA_BASE_URL: 'http://localhost:11434',
        AI_OLLAMA_MODEL: 'llama3',
        AI_EXTRACTION_TIMEOUT_MS: 60000,
      };
      return overrides[key] ?? defaults[key];
    }),
  } as never;
}

describe('OllamaAdapter', () => {
  let httpService: HttpService;

  beforeEach(() => {
    httpService = {
      post: vi.fn(),
      get: vi.fn(),
    } as never;
  });

  it('hat providerKey "ollama"', () => {
    const config = createMockConfig();
    const adapter = new OllamaAdapter(httpService, config);
    expect(adapter.providerKey).toBe('ollama');
  });

  it('extractContractFacts gibt null bei leeren Dokumenten', async () => {
    const config = createMockConfig();
    const adapter = new OllamaAdapter(httpService, config);

    const result = await adapter.extractContractFacts([], 'policy-1');
    expect(result).toBeNull();
  });

  it('extractContractFacts gibt null bei API-Fehler', async () => {
    const config = createMockConfig();
    const adapter = new OllamaAdapter(httpService, config);

    vi.mocked(httpService.post).mockReturnValue(
      of({ data: { message: { content: '' }, done: true } }) as never,
    );

    const result = await adapter.extractContractFacts(['test'], 'policy-1');
    expect(result).toBeNull();
  });

  it('verarbeitet erfolgreiche API-Antwort', async () => {
    const config = createMockConfig();
    const adapter = new OllamaAdapter(httpService, config);

    const mockResponse = {
      model: 'llama3',
      message: {
        content: JSON.stringify({
          insurerName: 'Test AG',
          contractNumber: 'POL-123',
          confidence: {
            insurerName: 0.95,
            contractNumber: 0.9,
          },
        }),
      },
      done: true,
    };

    vi.mocked(httpService.post).mockReturnValue(
      of({ data: mockResponse }) as never,
    );

    const result = await adapter.extractContractFacts(['Test content'], 'policy-1');

    expect(result).not.toBeNull();
    expect(result!.fields.insurerName).toBe('Test AG');
    expect(result!.fields.contractNumber).toBe('POL-123');
    expect(result!.confidence.insurerName).toBe(0.95);
    expect(result!.model).toBe('llama3');
  });

  it('summarizeCoverage gibt null bei leeren Dokumenten', async () => {
    const config = createMockConfig();
    const adapter = new OllamaAdapter(httpService, config);

    const result = await adapter.summarizeCoverage([], 'policy-1');
    expect(result).toBeNull();
  });

  it('healthCheck gibt false bei API-Fehler', async () => {
    const config = createMockConfig();
    const adapter = new OllamaAdapter(httpService, config);

    vi.mocked(httpService.get).mockReturnValue(
      of({ status: 500 }) as never,
    );

    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});
