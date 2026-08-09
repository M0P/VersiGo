import { describe, it, expect, vi, beforeEach } from 'vitest';
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
): AiExtractionProcessor {
  return new AiExtractionProcessor(db, settings);
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
