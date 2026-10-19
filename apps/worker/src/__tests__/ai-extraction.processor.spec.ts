import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AiExtractionProcessor } from '../ai-extraction.processor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDb(): any {
  return {
    aiExtractionJob: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    policyDocument: {
      findMany: vi.fn(),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockSettings(settingsOverrides: Record<string, unknown> = {}): any {
  return {
    getEffectiveBoolean: vi.fn(async (key: string) =>
      settingsOverrides[key] !== undefined ? Boolean(settingsOverrides[key]) : false,
    ),
    getEffectiveString: vi.fn(async (key: string) =>
      settingsOverrides[key] !== undefined ? String(settingsOverrides[key]) : '',
    ),
    getEffectiveNumber: vi.fn(async (key: string) =>
      settingsOverrides[key] !== undefined ? Number(settingsOverrides[key]) : null,
    ),
  };
}

function createProcessor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paperless: any = { getDocumentContent: vi.fn(async () => null) },
): AiExtractionProcessor {
  return new AiExtractionProcessor(db, settings, paperless);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockJob(data: Record<string, any> = {}): any {
  return {
    id: 'test-job-1',
    data: {
      jobId: 'test-job-1',
      policyId: 'policy-1',
      documentIds: ['doc-1', 'doc-2'],
      providerKey: 'none',
      ...data,
    },
  };
}

describe('AiExtractionProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with AI disabled', () => {
    it('should use NoOp adapter which triggers retry on null extraction', async () => {
      const db = createMockDb();
      const settings = createMockSettings({ AI_ENABLED: false });
      const processor = createProcessor(db, settings);

      db.aiExtractionJob.update.mockResolvedValue({});
      db.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-1', fileName: 'test.pdf', mimeType: 'application/pdf' },
      ]);

      const result = await processor.process(mockJob());

      // NoOp always returns null → retry is thrown → caught as failure
      expect(result.success).toBe(false);
      expect(result.error).toContain('retry required');
      // Job was set to RUNNING first, then to PENDING (retry)
      expect(db.aiExtractionJob.update).toHaveBeenCalledTimes(2);
      expect(db.aiExtractionJob.update.mock.calls[0][0].data.status).toBe('RUNNING');
      expect(db.aiExtractionJob.update.mock.calls[1][0].data.status).toBe('PENDING');
    });

    it('should skip job when no documents are available', async () => {
      const db = createMockDb();
      const settings = createMockSettings({ AI_ENABLED: false });
      const processor = createProcessor(db, settings);

      db.aiExtractionJob.update.mockResolvedValue({});
      db.policyDocument.findMany.mockResolvedValue([]);

      const result = await processor.process(mockJob());

      expect(result).toEqual({ success: true });
      expect(db.aiExtractionJob.update.mock.calls[0][0].data.status).toBe('RUNNING');
      expect(db.aiExtractionJob.update.mock.calls[1][0].data.status).toBe('SKIPPED');
    });
  });

  // AP-25: the provider must receive the OCR text of a linked document, not
  // just its file name – otherwise no extraction can ever describe it.
  describe('document content', () => {
    it('sends the Paperless OCR text of a linked document to the provider', async () => {
      const db = createMockDb();
      const settings = createMockSettings({
        AI_ENABLED: true,
        AI_PROVIDER: 'ollama',
        AI_OLLAMA_BASE_URL: 'http://ollama:11434',
        AI_OLLAMA_MODEL: 'llama3',
        AI_EXTRACTION_TIMEOUT_MS: 60000,
        AI_MAX_INPUT_TOKENS: 4096,
      });
      const paperless = { getDocumentContent: vi.fn(async () => 'Deckungssumme 10.000.000 EUR') };
      const processor = createProcessor(db, settings, paperless);

      db.aiExtractionJob.update.mockResolvedValue({});
      db.policyDocument.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          fileName: 'Police.pdf',
          mimeType: 'application/pdf',
          storageType: 'PAPERLESS_LINK',
          storageRef: '42',
        },
      ]);
      const post = vi.spyOn(axios, 'post').mockResolvedValue({
        data: { message: { content: '{"contractNumber": "ABC"}' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await processor.process(mockJob({ documentIds: ['doc-1'] }));

      expect(paperless.getDocumentContent).toHaveBeenCalledWith(42);
      const body = post.mock.calls[0][1] as {
        messages: { role: string; content: string }[];
      };
      const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
      expect(userContent).toContain('Deckungssumme 10.000.000 EUR');
      expect(userContent).toContain('Police.pdf');

      post.mockRestore();
    });

    it('falls back to the file name when Paperless has no OCR text', async () => {
      const db = createMockDb();
      const settings = createMockSettings({
        AI_ENABLED: true,
        AI_PROVIDER: 'ollama',
        AI_OLLAMA_BASE_URL: 'http://ollama:11434',
        AI_OLLAMA_MODEL: 'llama3',
      });
      const paperless = { getDocumentContent: vi.fn(async () => null) };
      const processor = createProcessor(db, settings, paperless);

      db.aiExtractionJob.update.mockResolvedValue({});
      db.policyDocument.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          fileName: 'Police.pdf',
          mimeType: 'application/pdf',
          storageType: 'PAPERLESS_LINK',
          storageRef: '42',
        },
      ]);
      const post = vi.spyOn(axios, 'post').mockResolvedValue({
        data: { message: { content: '{"contractNumber": "ABC"}' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await processor.process(mockJob({ documentIds: ['doc-1'] }));

      const body = post.mock.calls[0][1] as {
        messages: { role: string; content: string }[];
      };
      const userContent = body.messages.find((m) => m.role === 'user')?.content ?? '';
      expect(userContent).toContain('Police.pdf');
      expect(userContent).not.toContain('OCR aus Paperless');

      post.mockRestore();
    });

    it('does not contact Paperless for an internal upload', async () => {
      const db = createMockDb();
      const settings = createMockSettings({
        AI_ENABLED: true,
        AI_PROVIDER: 'ollama',
        AI_OLLAMA_BASE_URL: 'http://ollama:11434',
      });
      const paperless = { getDocumentContent: vi.fn(async () => 'unused') };
      const processor = createProcessor(db, settings, paperless);

      db.aiExtractionJob.update.mockResolvedValue({});
      db.policyDocument.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          fileName: 'Scan.pdf',
          mimeType: 'application/pdf',
          storageType: 'INTERNAL',
          storageRef: 'uploads/scan.pdf',
        },
      ]);
      const post = vi.spyOn(axios, 'post').mockResolvedValue({
        data: { message: { content: '{"contractNumber": "ABC"}' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await processor.process(mockJob({ documentIds: ['doc-1'] }));

      expect(paperless.getDocumentContent).not.toHaveBeenCalled();

      post.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle database update errors gracefully', async () => {
      const db = createMockDb();
      const settings = createMockSettings({ AI_ENABLED: false });
      const processor = createProcessor(db, settings);

      db.aiExtractionJob.update.mockRejectedValue(new Error('DB error'));

      const result = await processor.process(mockJob());

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });

    it('should set job to FAILED when max retries reached', async () => {
      const db = createMockDb();
      const settings = createMockSettings({ AI_ENABLED: false });
      const processor = createProcessor(db, settings);

      db.aiExtractionJob.update.mockResolvedValue({});
      db.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-1', fileName: 'test.pdf', mimeType: 'application/pdf' },
      ]);

      // Simulate that we already exhausted retries
      db.aiExtractionJob.findUnique.mockResolvedValue({
        retryCount: 4,
        maxRetries: 3,
      });

      const result = await processor.process(mockJob());

      // With NoOp + AI disabled, extraction always returns null
      // After retry check: retryCount(4) > maxRetries(3) → FAILED
      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum number of retries');
    });
  });
});
