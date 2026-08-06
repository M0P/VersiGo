import { describe, it, expect, vi } from 'vitest';
import { PaperlessController } from '../paperless-ngx.controller';
import { IPaperlessAdapter } from '../paperless-ngx.interface';

// BugFix-07 (Q3): GET /paperless/documents – Live-Suche mit kontrollierter
// Degradierung, wenn Paperless deaktiviert ist.
describe('PaperlessController', () => {
  function createMockAdapter(): IPaperlessAdapter {
    return {
      getDeepLink: vi.fn(),
      getDocumentMetadata: vi.fn(),
      syncDocument: vi.fn(),
      searchDocuments: vi.fn(),
      healthCheck: vi.fn(),
    };
  }

  it('sucht nach einem Suchbegriff und gibt Treffer zurueck', async () => {
    const adapter = createMockAdapter();
    adapter.searchDocuments = vi.fn().mockResolvedValue([
      { paperlessId: 42, title: 'KFZ-Versicherung', deepLink: 'https://paperless.example.com/documents/42/', tags: [], correspondent: null },
    ]);
    const controller = new PaperlessController(adapter);

    const result = await controller.search({ search: 'KFZ' });

    expect(adapter.searchDocuments).toHaveBeenCalledWith('KFZ');
    expect(result).toHaveLength(1);
    expect(result[0].paperlessId).toBe(42);
  });

  it('liefert ein leeres Ergebnis bei leerem Suchbegriff', async () => {
    const adapter = createMockAdapter();
    const controller = new PaperlessController(adapter);

    const result = await controller.search({ search: '   ' });

    expect(adapter.searchDocuments).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('liefert ein leeres Ergebnis ohne Suchbegriff', async () => {
    const adapter = createMockAdapter();
    const controller = new PaperlessController(adapter);

    const result = await controller.search({});

    expect(adapter.searchDocuments).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('degradiert kontrolliert, wenn Paperless nicht konfiguriert ist', async () => {
    const adapter = createMockAdapter();
    adapter.searchDocuments = vi.fn().mockResolvedValue([]);
    const controller = new PaperlessController(adapter);

    const result = await controller.search({ search: 'Versicherung' });

    expect(result).toEqual([]);
  });
});
