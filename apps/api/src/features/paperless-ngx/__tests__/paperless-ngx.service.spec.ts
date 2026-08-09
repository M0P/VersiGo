import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { SettingsResolverService } from '@versigo/foundation';
import { PaperlessNgxService } from '../paperless-ngx.service';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import type { AxiosResponse } from 'axios';

type MockSettingsValues = Record<string, string | boolean | undefined>;

function createMockSettings(values: MockSettingsValues = {}) {
  return {
    getEffectiveString: vi.fn(async (key: string) => {
      const value = values[key];
      return typeof value === 'string' ? value : undefined;
    }),
    getEffectiveBoolean: vi.fn(async (key: string) => {
      const value = values[key];
      return typeof value === 'boolean' ? value : undefined;
    }),
    getEffectiveNumber: vi.fn(async () => undefined),
  } as unknown as SettingsResolverService;
}

type MockHttpService = HttpService & { get: ReturnType<typeof vi.fn> };

function createMockHttpService(): MockHttpService {
  return {
    get: vi.fn(),
  } as unknown as MockHttpService;
}

function configuredValues(overrides: MockSettingsValues = {}): MockSettingsValues {
  return {
    PAPERLESS_ENABLED: true,
    PAPERLESS_URL: 'http://paperless:8000',
    PAPERLESS_API_TOKEN: 'test-token-123',
    ...overrides,
  };
}

/** AxiosError shaped like the user's Paperless 3.x 406 rejection. */
function notAcceptableError(): AxiosError {
  return new AxiosError(
    'Request failed with status code 406',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      data: { detail: 'Invalid version in "Accept" header.' },
      status: 406,
      statusText: 'Not Acceptable',
      headers: {},
      config: {},
    } as AxiosResponse,
  );
}

function searchResultPayload(payload: Record<string, unknown> = {}) {
  return {
    data: {
      results: [
        {
          id: 10,
          title: 'Police Haftpflicht',
          tags: [1],
          correspondent: 5,
          document_type: null,
          notes: null,
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
          ...payload,
        },
      ],
    },
  };
}

describe('PaperlessNgxService', () => {
  let mockHttp: MockHttpService;
  let mockSettings: ReturnType<typeof createMockSettings>;
  let service: PaperlessNgxService;

  beforeEach(() => {
    mockHttp = createMockHttpService();
    mockSettings = createMockSettings(configuredValues());
    service = new PaperlessNgxService(mockHttp, mockSettings);
  });

  describe('healthCheck', () => {
    it('returns true on a successful API response', async () => {
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      const result = await service.healthCheck();
      expect(result).toBe(true);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Token test-token-123' }),
        }),
      );
    });

    it('returns false on error', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Network error', 'ECONNREFUSED')),
      );
      const result = await service.healthCheck();
      expect(result).toBe(false);
    });

    it('returns false when disabled', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.healthCheck();
      expect(result).toBe(false);
      expect(mockHttp.get).not.toHaveBeenCalled();
    });

    it('returns false when the configuration is incomplete', async () => {
      const incompleteService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_API_TOKEN: undefined })),
      );
      const result = await incompleteService.healthCheck();
      expect(result).toBe(false);
      expect(mockHttp.get).not.toHaveBeenCalled();
    });
  });

  describe('getDeepLink', () => {
    it('returns the deep-link URL for an existing document', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        of({
          data: { id: 42, title: 'Testdokument.pdf' },
        }),
      );

      const result = await service.getDeepLink(42);
      expect(result).toBe('http://paperless:8000/documents/42/');
    });

    it('returns null for a missing document', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, { data: {}, status: 404, statusText: 'Not Found', headers: {}, config: {} } as AxiosResponse)),
      );

      const result = await service.getDeepLink(42);
      expect(result).toBeNull();
    });

    it('returns null when disabled', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.getDeepLink(42);
      expect(result).toBeNull();
      expect(mockHttp.get).not.toHaveBeenCalled();
    });
  });

  describe('getDocumentMetadata', () => {
    it('returns metadata on a successful fetch', async () => {
      mockHttp.get = vi.fn().mockImplementation((url: string) => {
        if (url === 'http://paperless:8000/api/documents/42/') {
          return of({
            data: {
              id: 42,
              title: 'Versicherungsschein',
              tags: [1, 2],
              correspondent: 5,
              document_type: 3,
              notes: [{ note: 'Wichtiger Hinweis' }],
              created: '2024-01-15T10:00:00Z',
              modified: '2024-06-20T12:00:00Z',
            },
          });
        }
        if (url.includes('/correspondents/5/')) {
          return of({ data: { id: 5, name: 'AXA Versicherung' } });
        }
        if (url.includes('/document_types/3/')) {
          return of({ data: { id: 3, name: 'Versicherungsschein' } });
        }
        if (url.includes('/tags/1/')) {
          return of({ data: { id: 1, name: 'wichtig' } });
        }
        if (url.includes('/tags/2/')) {
          return of({ data: { id: 2, name: '2024' } });
        }
        return of({ data: {} });
      });

      const result = await service.getDocumentMetadata(42);

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Versicherungsschein');
      expect(result!.tags).toEqual(['wichtig', '2024']);
      expect(result!.correspondent).toBe('AXA Versicherung');
      expect(result!.documentType).toBe('Versicherungsschein');
      expect(result!.notes).toBe('Wichtiger Hinweis');
      expect(result!.createdAt).toBe('2024-01-15T10:00:00Z');
    });

    it('returns null on API error', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Server Error', 'ERR_BAD_RESPONSE')),
      );

      const result = await service.getDocumentMetadata(42);
      expect(result).toBeNull();
    });

    it('returns null when disabled', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.getDocumentMetadata(42);
      expect(result).toBeNull();
    });
  });

  describe('syncDocument', () => {
    it('returns success for an existing Paperless document', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        of({
          data: { id: 42, title: 'Test.pdf' },
        }),
      );

      const result = await service.syncDocument(42);
      expect(result.success).toBe(true);
      expect(result.paperlessId).toBe(42);
      expect(result.deepLink).toBe('http://paperless:8000/documents/42/');
    });

    it('returns an error for a missing document', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, { data: {}, status: 404, statusText: 'Not Found', headers: {}, config: {} } as AxiosResponse)),
      );

      const result = await service.syncDocument(999);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Document not found in Paperless');
    });

    it('returns an error when Paperless is disabled', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.syncDocument(42);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Paperless is not configured');
    });
  });

  describe('searchDocuments', () => {
    it('returns search results', async () => {
      mockHttp.get = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/documents/?query=')) {
          return of(searchResultPayload());
        }
        if (url.includes('/tags/1/')) {
          return of({ data: { id: 1, name: 'haftpflicht' } });
        }
        if (url.includes('/correspondents/5/')) {
          return of({ data: { id: 5, name: 'HUK' } });
        }
        return of({ data: {} });
      });

      const results = await service.searchDocuments('haftpflicht');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Police Haftpflicht');
      expect(results[0].tags).toEqual(['haftpflicht']);
      expect(results[0].correspondent).toBe('HUK');
      expect(results[0].deepLink).toBe('http://paperless:8000/documents/10/');
    });

    it('returns an empty array on error', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Service Unavailable', 'ECONNREFUSED')),
      );

      const results = await service.searchDocuments('test');
      expect(results).toEqual([]);
    });

    it('returns an empty array when disabled', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const results = await disabledService.searchDocuments('test');
      expect(results).toEqual([]);
    });
  });

  describe('API-dialect auto-negotiation (BugFix-11)', () => {
    it('falls back to legacy when the server rejects the versioned header (406): search uses unversioned Accept + q=', async () => {
      mockHttp.get = vi
        .fn()
        .mockReturnValueOnce(throwError(() => notAcceptableError()))
        .mockImplementation((url: string) => {
          if (url.includes('/documents/?q=')) {
            return of(searchResultPayload());
          }
          if (url.includes('/tags/1/')) {
            return of({ data: { id: 1, name: 'haftpflicht' } });
          }
          if (url.includes('/correspondents/5/')) {
            return of({ data: { id: 5, name: 'HUK' } });
          }
          return of({ data: {} });
        });

      const results = await service.searchDocuments('haftpflicht');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Police Haftpflicht');

      // Search must use the legacy param `q` and the unversioned Accept header.
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/documents/?q=haftpflicht',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
        }),
      );
      // The v2 param `query` must NOT be used on a legacy server.
      expect(mockHttp.get).not.toHaveBeenCalledWith(
        'http://paperless:8000/api/documents/?query=haftpflicht',
        expect.anything(),
      );
    });

    it('stays on v2 when the server accepts the versioned header', async () => {
      mockHttp.get = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/documents/?query=')) {
          return of(searchResultPayload());
        }
        if (url.includes('/tags/1/')) {
          return of({ data: { id: 1, name: 'haftpflicht' } });
        }
        if (url.includes('/correspondents/5/')) {
          return of({ data: { id: 5, name: 'HUK' } });
        }
        return of({ data: {} });
      });

      const results = await service.searchDocuments('haftpflicht');
      expect(results).toHaveLength(1);

      // Probe answered 200 -> v2 stays, search uses `query` + versioned Accept.
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/documents/?query=haftpflicht',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json;version=2' }),
        }),
      );
    });

    it('healthCheck uses the negotiated dialect header', async () => {
      mockHttp.get = vi
        .fn()
        .mockReturnValueOnce(throwError(() => notAcceptableError()))
        .mockReturnValue(of({ status: 200, data: {} }));

      const result = await service.healthCheck();
      expect(result).toBe(true);

      // healthCheck GET /api/ must carry the unversioned Accept after fallback.
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
        }),
      );
    });

    it('caches the dialect per configuration and re-probes after a config change', async () => {
      const probeUrl = 'http://paperless:8000/api/documents/?page_size=1';
      mockHttp.get = vi
        .fn()
        .mockReturnValue(throwError(() => notAcceptableError()));

      // First use -> exactly one probe.
      await service.searchDocuments('a');
      expect(mockHttp.get.mock.calls.filter(([url]) => url === probeUrl)).toHaveLength(1);

      // Same configuration -> cached, no additional probe.
      mockHttp.get.mockClear();
      await service.searchDocuments('b');
      expect(mockHttp.get.mock.calls.filter(([url]) => url === probeUrl)).toHaveLength(0);

      // Configuration change (new baseUrl) -> re-probe.
      const changedService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_URL: 'http://paperless2:8000' })),
      );
      await changedService.searchDocuments('c');
      expect(
        mockHttp.get.mock.calls.filter(([url]) => url === 'http://paperless2:8000/api/documents/?page_size=1'),
      ).toHaveLength(1);
    });

    it('keeps v2 on a 401/403 probe response (wrong token/permission, not a dialect issue)', async () => {
      const unauthorized = new AxiosError(
        'Unauthorized',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        { data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config: {} } as AxiosResponse,
      );
      mockHttp.get = vi
        .fn()
        .mockReturnValueOnce(throwError(() => unauthorized))
        .mockImplementation((url: string) => {
          if (url.includes('/documents/?query=')) {
            return of(searchResultPayload());
          }
          return of({ data: {} });
        });

      const results = await service.searchDocuments('test');
      expect(results).toHaveLength(1);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/documents/?query=test',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json;version=2' }),
        }),
      );
    });

    it('does not cache the dialect when the probe fails transiently – the next call re-probes', async () => {
      const probeUrl = 'http://paperless:8000/api/documents/?page_size=1';
      const networkError = new AxiosError('Network error', 'ECONNREFUSED');
      mockHttp.get = vi
        .fn()
        .mockReturnValue(throwError(() => networkError));

      // First call: probe fails (network error) -> v2 used for the call, NOT cached.
      await service.searchDocuments('a');
      expect(mockHttp.get.mock.calls.filter(([url]) => url === probeUrl)).toHaveLength(1);

      // Second call: no cache entry -> probe runs again.
      await service.searchDocuments('b');
      expect(mockHttp.get.mock.calls.filter(([url]) => url === probeUrl)).toHaveLength(2);

      // The failed probe never pinned the dialect to v2: once the server
      // answers 406, a later call switches to legacy (unversioned Accept + q=).
      mockHttp.get = vi
        .fn()
        .mockReturnValueOnce(throwError(() => notAcceptableError()))
        .mockImplementation((url: string) => {
          if (url.includes('/documents/?q=')) {
            return of(searchResultPayload());
          }
          return of({ data: {} });
        });
      const results = await service.searchDocuments('c');
      expect(results).toHaveLength(1);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/documents/?q=c',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
        }),
      );
    });
  });

  describe('Runtime resolution (AP-17)', () => {
    it('reads the configuration per call through SettingsResolverService', async () => {
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      await service.healthCheck();
      expect(mockSettings.getEffectiveBoolean).toHaveBeenCalledWith('PAPERLESS_ENABLED');
      expect(mockSettings.getEffectiveString).toHaveBeenCalledWith('PAPERLESS_URL');
      expect(mockSettings.getEffectiveString).toHaveBeenCalledWith('PAPERLESS_API_TOKEN');
    });

    it('normalizes a trailing slash in PAPERLESS_URL', async () => {
      const trailingService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_URL: 'http://paperless:8000/' })),
      );
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      const result = await trailingService.healthCheck();
      expect(result).toBe(true);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://paperless:8000/api/',
        expect.anything(),
      );
    });
  });

  describe('HTTPS warning (runtime)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy?.mockRestore();
    });

    it('warns when PAPERLESS_URL is not HTTPS', async () => {
      const httpService = new PaperlessNgxService(mockHttp, mockSettings);
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      await httpService.healthCheck();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('does not use HTTPS'));
    });

    it('does not warn when PAPERLESS_URL uses HTTPS', async () => {
      const httpsService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_URL: 'https://paperless.example.com' })),
      );
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      await httpsService.healthCheck();

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('does not use HTTPS'));
    });

    it('does not warn when Paperless is disabled', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.healthCheck();
      expect(result).toBe(false);

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('does not use HTTPS'));
    });
  });
});
