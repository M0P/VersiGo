import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { SettingsResolverService } from '@versigo/foundation';
import { PaperlessNgxService } from '../paperless-ngx.service';
import { NoOpPaperlessAdapter } from '../paperless-ngx.noop';
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

function createMockHttpService() {
  return {
    get: vi.fn(),
  } as unknown as HttpService;
}

function configuredValues(overrides: MockSettingsValues = {}): MockSettingsValues {
  return {
    PAPERLESS_ENABLED: true,
    PAPERLESS_URL: 'http://paperless:8000',
    PAPERLESS_API_TOKEN: 'test-token-123',
    ...overrides,
  };
}

describe('PaperlessNgxService', () => {
  let mockHttp: ReturnType<typeof createMockHttpService>;
  let mockSettings: ReturnType<typeof createMockSettings>;
  let service: PaperlessNgxService;

  beforeEach(() => {
    mockHttp = createMockHttpService();
    mockSettings = createMockSettings(configuredValues());
    service = new PaperlessNgxService(mockHttp, mockSettings);
  });

  describe('healthCheck', () => {
    it('gibt true zurueck bei erfolgreicher API-Antwort', async () => {
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

    it('gibt false zurueck bei Fehler', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Netzwerkfehler', 'ECONNREFUSED')),
      );
      const result = await service.healthCheck();
      expect(result).toBe(false);
    });

    it('gibt false zurueck wenn deaktiviert', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.healthCheck();
      expect(result).toBe(false);
      expect(mockHttp.get).not.toHaveBeenCalled();
    });

    it('gibt false zurueck wenn Konfiguration unvollstaendig ist', async () => {
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
    it('gibt Deep-Link-URL zurueck bei vorhandenem Dokument', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        of({
          data: { id: 42, title: 'Testdokument.pdf' },
        }),
      );

      const result = await service.getDeepLink(42);
      expect(result).toBe('http://paperless:8000/documents/42/');
    });

    it('gibt null zurueck bei fehlendem Dokument', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, { data: {}, status: 404, statusText: 'Not Found', headers: {}, config: {} } as AxiosResponse)),
      );

      const result = await service.getDeepLink(42);
      expect(result).toBeNull();
    });

    it('gibt null zurueck wenn deaktiviert', async () => {
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
    it('gibt Metadaten zurueck bei erfolgreichem Abruf', async () => {
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

    it('gibt null zurueck bei API-Fehler', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Server Error', 'ERR_BAD_RESPONSE')),
      );

      const result = await service.getDocumentMetadata(42);
      expect(result).toBeNull();
    });

    it('gibt null zurueck wenn deaktiviert', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.getDocumentMetadata(42);
      expect(result).toBeNull();
    });
  });

  describe('syncDocument', () => {
    it('gibt Erfolg zurueck bei vorhandenem Paperless-Dokument', async () => {
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

    it('gibt Fehler zurueck bei nicht gefundenem Dokument', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, { data: {}, status: 404, statusText: 'Not Found', headers: {}, config: {} } as AxiosResponse)),
      );

      const result = await service.syncDocument(999);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Dokument in Paperless nicht gefunden');
    });

    it('gibt Fehler zurueck bei deaktiviertem Paperless', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.syncDocument(42);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Paperless nicht konfiguriert');
    });
  });

  describe('searchDocuments', () => {
    it('gibt Suchergebnisse zurueck', async () => {
      mockHttp.get = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/documents/?query=')) {
          return of({
            data: {
              results: [
                { id: 10, title: 'Police Haftpflicht', tags: [1], correspondent: 5, document_type: null, notes: null, created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' },
              ],
            },
          });
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

    it('gibt leeres Array zurueck bei Fehler', async () => {
      mockHttp.get = vi.fn().mockReturnValue(
        throwError(() => new AxiosError('Service Unavailable', 'ECONNREFUSED')),
      );

      const results = await service.searchDocuments('test');
      expect(results).toEqual([]);
    });

    it('gibt leeres Array zurueck wenn deaktiviert', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const results = await disabledService.searchDocuments('test');
      expect(results).toEqual([]);
    });
  });

  describe('Laufzeit-Aufloesung (AP-17)', () => {
    it('liest Konfiguration pro Aufruf ueber SettingsResolverService', async () => {
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      await service.healthCheck();
      expect(mockSettings.getEffectiveBoolean).toHaveBeenCalledWith('PAPERLESS_ENABLED');
      expect(mockSettings.getEffectiveString).toHaveBeenCalledWith('PAPERLESS_URL');
      expect(mockSettings.getEffectiveString).toHaveBeenCalledWith('PAPERLESS_API_TOKEN');
    });

    it('normalisiert eine trailing Slash in PAPERLESS_URL', async () => {
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

  describe('HTTPS-Warnung (Laufzeit)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy?.mockRestore();
    });

    it('warnt bei PAPERLESS_URL ohne HTTPS', async () => {
      const httpService = new PaperlessNgxService(mockHttp, mockSettings);
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      await httpService.healthCheck();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('kein HTTPS'));
    });

    it('warnt nicht bei PAPERLESS_URL mit HTTPS', async () => {
      const httpsService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_URL: 'https://paperless.example.com' })),
      );
      mockHttp.get = vi.fn().mockReturnValue(of({ status: 200, data: {} }));
      await httpsService.healthCheck();

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('kein HTTPS'));
    });

    it('warnt nicht bei deaktiviertem Paperless', async () => {
      const disabledService = new PaperlessNgxService(
        mockHttp,
        createMockSettings(configuredValues({ PAPERLESS_ENABLED: false })),
      );
      const result = await disabledService.healthCheck();
      expect(result).toBe(false);

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('kein HTTPS'));
    });
  });
});

describe('NoOpPaperlessAdapter', () => {
  let noop: NoOpPaperlessAdapter;

  beforeEach(() => {
    noop = new NoOpPaperlessAdapter();
  });

  it('getDeepLink gibt null zurueck', async () => {
    expect(await noop.getDeepLink(42)).toBeNull();
  });

  it('getDocumentMetadata gibt null zurueck', async () => {
    expect(await noop.getDocumentMetadata(42)).toBeNull();
  });

  it('syncDocument gibt Fehler zurueck', async () => {
    const result = await noop.syncDocument(42);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Paperless deaktiviert');
  });

  it('searchDocuments gibt leeres Array zurueck', async () => {
    expect(await noop.searchDocuments('test')).toEqual([]);
  });

  it('healthCheck gibt false zurueck', async () => {
    expect(await noop.healthCheck()).toBe(false);
  });
});
