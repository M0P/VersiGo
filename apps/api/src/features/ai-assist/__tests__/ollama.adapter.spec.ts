import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import type { SettingsResolverService } from '@versigo/foundation';
import { OllamaAdapter } from '../ollama.adapter';
import { of } from 'rxjs';

function createMockSettings(overrides: Record<string, string | number | boolean> = {}): SettingsResolverService {
  return {
    getEffectiveString: vi.fn(async (key: string) => {
      const defaults: Record<string, string> = {
        AI_OLLAMA_BASE_URL: 'http://localhost:11434',
        AI_OLLAMA_MODEL: 'llama3',
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

describe('OllamaAdapter', () => {
  let httpService: HttpService;

  beforeEach(() => {
    httpService = {
      post: vi.fn(),
      get: vi.fn(),
    } as never;
  });

  it('hat providerKey "ollama"', () => {
    const settings = createMockSettings();
    const adapter = new OllamaAdapter(httpService, settings);
    expect(adapter.providerKey).toBe('ollama');
  });

  it('extractContractFacts gibt null bei leeren Dokumenten', async () => {
    const settings = createMockSettings();
    const adapter = new OllamaAdapter(httpService, settings);

    const result = await adapter.extractContractFacts([], 'policy-1');
    expect(result).toBeNull();
  });

  it('extractContractFacts gibt null bei API-Fehler', async () => {
    const settings = createMockSettings();
    const adapter = new OllamaAdapter(httpService, settings);

    vi.mocked(httpService.post).mockReturnValue(
      of({ data: { message: { content: '' }, done: true } }) as never,
    );

    const result = await adapter.extractContractFacts(['test'], 'policy-1');
    expect(result).toBeNull();
  });

  it('verarbeitet erfolgreiche API-Antwort', async () => {
    const settings = createMockSettings();
    const adapter = new OllamaAdapter(httpService, settings);

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
    const settings = createMockSettings();
    const adapter = new OllamaAdapter(httpService, settings);

    const result = await adapter.summarizeCoverage([], 'policy-1');
    expect(result).toBeNull();
  });

  it('healthCheck gibt false bei API-Fehler', async () => {
    const settings = createMockSettings();
    const adapter = new OllamaAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(
      of({ status: 500 }) as never,
    );

    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });
});
