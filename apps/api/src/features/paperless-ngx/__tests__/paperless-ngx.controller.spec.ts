import { describe, it, expect, vi } from 'vitest';
import { PaperlessController } from '../paperless-ngx.controller';
import { IPaperlessAdapter } from '../paperless-ngx.interface';

// BugFix-07 (Q3): GET /paperless/documents – live search with controlled
// degradation when Paperless is disabled.
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

  it('searches for a term and returns matches', async () => {
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

  it('returns an empty result for an empty search term', async () => {
    const adapter = createMockAdapter();
    const controller = new PaperlessController(adapter);

    const result = await controller.search({ search: '   ' });

    expect(adapter.searchDocuments).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns an empty result without a search term', async () => {
    const adapter = createMockAdapter();
    const controller = new PaperlessController(adapter);

    const result = await controller.search({});

    expect(adapter.searchDocuments).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('degrades in a controlled way when Paperless is not configured', async () => {
    const adapter = createMockAdapter();
    adapter.searchDocuments = vi.fn().mockResolvedValue([]);
    const controller = new PaperlessController(adapter);

    const result = await controller.search({ search: 'Versicherung' });

    expect(result).toEqual([]);
  });
});
