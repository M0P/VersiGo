import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import type { SettingsResolverService } from '@versigo/foundation';
import { AxiosError } from 'axios';
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

  // --- BugFix-22: keyless endpoints, detailed reasons ---

  it('treats a missing API key as configured (keyless endpoints)', async () => {
    const settings = createMockSettings({ AI_OPENAI_COMPAT_API_KEY: '' });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(
      of({ status: 200, data: {} }) as never,
    );

    expect(await adapter.healthCheck()).toBe(true);
    // No empty `Bearer ` header may be sent to a keyless endpoint.
    expect(vi.mocked(httpService.get).mock.calls[0][1]).not.toHaveProperty(
      'headers.Authorization',
    );
  });

  it('sends no Authorization header for keyless completions', async () => {
    const settings = createMockSettings({ AI_OPENAI_COMPAT_API_KEY: '' });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.post).mockReturnValue(
      of({
        data: {
          id: 'chat-1',
          model: 'gpt-4o-mini',
          choices: [{ message: { role: 'assistant', content: '{"a":1}' }, finish_reason: 'stop' }],
        },
      }) as never,
    );

    await adapter.extractContractFacts(['x'], 'policy-1');

    const options = vi.mocked(httpService.post).mock.calls[0][2] as {
      headers: Record<string, string>;
    };
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('healthStatus reports "not-configured" without a base URL', async () => {
    const settings = createMockSettings({ AI_OPENAI_COMPAT_BASE_URL: '' });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    expect(await adapter.healthStatus()).toEqual({
      connected: false,
      reason: 'not-configured',
    });
    expect(httpService.get).not.toHaveBeenCalled();
  });

  it('healthStatus reports "unauthorized" on HTTP 401', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(
      of({ status: 401, data: {} }) as never,
    );

    expect(await adapter.healthStatus()).toEqual({
      connected: false,
      reason: 'unauthorized',
    });
  });

  it('healthStatus reports "http-error" on HTTP 500', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(
      of({ status: 500, data: {} }) as never,
    );

    expect(await adapter.healthStatus()).toEqual({
      connected: false,
      reason: 'http-error',
    });
  });

  it('falls back to chat/completions when /models is not implemented', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(of({ status: 404, data: {} }) as never);
    vi.mocked(httpService.post).mockReturnValue(of({ status: 200, data: {} }) as never);

    expect(await adapter.healthStatus()).toEqual({ connected: true, reason: null });
    expect(httpService.get).toHaveBeenCalledTimes(1);
    expect(httpService.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(httpService.post).mock.calls[0][0]).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('reuses a successful fallback probe for a short time', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(of({ status: 404, data: {} }) as never);
    vi.mocked(httpService.post).mockReturnValue(of({ status: 200, data: {} }) as never);

    expect(await adapter.healthStatus()).toEqual({ connected: true, reason: null });
    expect(await adapter.healthStatus()).toEqual({ connected: true, reason: null });

    // The completion probe costs tokens – it must not run per page view.
    expect(httpService.post).toHaveBeenCalledTimes(1);
  });

  it('healthStatus does not fall back when the completion also fails', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockReturnValue(of({ status: 404, data: {} }) as never);
    vi.mocked(httpService.post).mockReturnValue(of({ status: 401, data: {} }) as never);

    expect(await adapter.healthStatus()).toEqual({
      connected: false,
      reason: 'unauthorized',
    });
  });

  it('healthStatus reports "timeout" for a timed out request', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockImplementation(() => {
      throw new AxiosError('timeout of 5000ms exceeded', 'ECONNABORTED');
    });

    expect(await adapter.healthStatus()).toEqual({
      connected: false,
      reason: 'timeout',
    });
  });

  it('healthStatus reports "unreachable" for a connection error', async () => {
    const settings = createMockSettings();
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.get).mockImplementation(() => {
      throw new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
    });

    expect(await adapter.healthStatus()).toEqual({
      connected: false,
      reason: 'unreachable',
    });
  });

  // --- AP-25: input token budget ------------------------------------------

  it('shortens document content beyond the configured input token budget', async () => {
    const settings = createMockSettings({ AI_MAX_INPUT_TOKENS: 10 });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.post).mockReturnValue(
      of({
        data: {
          id: 'chat-1',
          model: 'gpt-4o-mini',
          choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        },
      }) as never,
    );

    await adapter.summarizeCoverage(['x'.repeat(4000)], 'policy-1');

    const body = vi.mocked(httpService.post).mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userContent.length).toBeLessThan(4000);
    expect(userContent).not.toContain('x'.repeat(500));
  });

  it('leaves document content untouched when the budget is unlimited (0)', async () => {
    const settings = createMockSettings({ AI_MAX_INPUT_TOKENS: 0 });
    const adapter = new OpenAiCompatAdapter(httpService, settings);

    vi.mocked(httpService.post).mockReturnValue(
      of({
        data: {
          id: 'chat-1',
          model: 'gpt-4o-mini',
          choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        },
      }) as never,
    );

    const long = 'y'.repeat(40_000);
    await adapter.summarizeCoverage([long], 'policy-1');

    const body = vi.mocked(httpService.post).mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userContent).toContain(long);
  });
});
