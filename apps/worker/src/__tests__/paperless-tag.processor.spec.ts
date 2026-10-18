import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paperlessTagSyncStaggerMs } from '@versigo/foundation';
import { PaperlessTagProcessor } from '../paperless-tag.processor';

const policyId = '33333333-3333-4333-3333-333333333333';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDb(): any {
  const db: Record<string, unknown> & {
    $transaction?: unknown;
  } = {
    insurancePolicy: {
      findUnique: vi.fn().mockResolvedValue({ id: policyId, archivedAt: null }),
    },
    policyPaperlessTag: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    policyDocument: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    paperlessTagJob: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockQueue(): any {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockSettings(): any {
  return {
    getEffectiveNumber: vi.fn().mockResolvedValue(300_000),
    getEffectiveBoolean: vi.fn().mockResolvedValue(true),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockClient(): any {
  return {
    baseUrl: vi.fn().mockResolvedValue('https://paperless.example.com'),
    getTag: vi.fn().mockResolvedValue({ ok: true, tagId: 7, name: 'KFZ' }),
    listDocumentsByTag: vi.fn().mockResolvedValue([]),
    assignTagToDocument: vi.fn().mockResolvedValue({ success: true, verified: true }),
  };
}

function job(name: string, data: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id: 'bull-1', name, data } as any;
}

describe('PaperlessTagProcessor', () => {
  let db: ReturnType<typeof createMockDb>;
  let queue: ReturnType<typeof createMockQueue>;
  let settings: ReturnType<typeof createMockSettings>;
  let client: ReturnType<typeof createMockClient>;
  let processor: PaperlessTagProcessor;

  beforeEach(() => {
    db = createMockDb();
    queue = createMockQueue();
    settings = createMockSettings();
    client = createMockClient();
    processor = new PaperlessTagProcessor(db, settings, queue, client);
  });

  function config(overrides: Record<string, unknown> = {}) {
    return {
      policyId,
      paperlessTagId: 7,
      paperlessTagName: 'KFZ',
      configVersion: 3,
      connectionRef: 'https://paperless.example.com',
      syncStatus: 'PENDING',
      syncErrorCode: null,
      lastSyncedAt: null,
      ...overrides,
    };
  }

  /** Update call of the reconciliation for one document id (BugFix-21 tests). */
  function updateFor(
    id: string,
  ): { where?: { id?: string }; data: Record<string, unknown> } | undefined {
    return db.policyDocument.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { where?: { id?: string } })?.where?.id === id,
    )?.[0] as { where?: { id?: string }; data: Record<string, unknown> } | undefined;
  }

  function syncJobRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'job-1',
      policyId,
      kind: 'SYNC_POLICY',
      status: 'PENDING',
      retryCount: 0,
      maxRetries: 3,
      configVersion: 3,
      ...overrides,
    };
  }

  describe('staleness protection', () => {
    it('skips a SYNC_POLICY job whose config version is outdated', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config({ configVersion: 4 }));

      const result = await processor.process(
        job('sync-policy', { jobId: 'job-1', policyId }),
      );

      expect(result.success).toBe(true);
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'STALE_CONFIG' }),
        }),
      );
      expect(client.listDocumentsByTag).not.toHaveBeenCalled();
      expect(db.policyDocument.create).not.toHaveBeenCalled();
      expect(db.policyDocument.update).not.toHaveBeenCalled();
    });

    it('does not report success or backfill when the config changes mid-reconciliation (round-3 fix)', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique
        .mockResolvedValueOnce(config()) // pre-flight version check
        .mockResolvedValue(config({ configVersion: 4 })); // changed during the walk
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 100, title: 'Police 2026' },
      ]);

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(true);
      // The run is recorded as superseded, never as completed.
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'STALE_CONFIG' }),
        }),
      );
      expect(db.paperlessTagJob.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      // Neither the ACTIVE state nor a backfill may be written for the
      // superseded configuration version.
      expect(db.policyPaperlessTag.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ syncStatus: 'ACTIVE' }),
        }),
      );
      expect(db.paperlessTagJob.create).not.toHaveBeenCalled();
    });

    it('skips a job when the tag has been removed in the meantime', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(client.getTag).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'STALE_CONFIG' }),
        }),
      );
    });

    it('skips a TAG_DOCUMENT job whose config version is outdated (removed tag)', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(
        syncJobRow({ kind: 'TAG_DOCUMENT', documentId: 'doc-1', configVersion: 2 }),
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(config({ configVersion: 3 }));

      await processor.process(job('tag-document', { jobId: 'job-1', policyId }));

      expect(client.assignTagToDocument).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'STALE_CONFIG' }),
        }),
      );
    });

    it('skips a job for an archived insurance (jobs are invalidated)', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      db.insurancePolicy.findUnique.mockResolvedValue({ id: policyId, archivedAt: new Date() });

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(true);
      expect(client.getTag).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'POLICY_ARCHIVED' }),
        }),
      );
    });

    it('ignores an already completed job (idempotent re-dispatch)', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow({ status: 'COMPLETED' }));

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(true);
      expect(db.policyDocument.create).not.toHaveBeenCalled();
      expect(client.getTag).not.toHaveBeenCalled();
    });
  });

  describe('failure handling keeps existing assignments', () => {
    it('keeps assignments and retries when Paperless is unreachable', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.getTag.mockResolvedValue({ ok: false, error: 'UNREACHABLE' });

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(false);
      expect(db.policyDocument.update).not.toHaveBeenCalled();
      expect(db.policyDocument.updateMany).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PENDING', retryCount: { increment: 1 }, errorCode: 'UNREACHABLE' },
        }),
      );
    });

    it('marks the configuration as errored when the tag no longer exists', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow({ retryCount: 3 }));
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.getTag.mockResolvedValue({ ok: false, error: 'NOT_FOUND' });

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.policyPaperlessTag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ syncStatus: 'ERROR', syncErrorCode: 'NOT_FOUND' }),
        }),
      );
      expect(db.policyDocument.updateMany).not.toHaveBeenCalled();
      expect(db.policyDocument.update).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', errorCode: 'NOT_FOUND' }),
        }),
      );
    });

    it('aborts a partial page walk without removing any assignment', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue(null);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.policyDocument.updateMany).not.toHaveBeenCalled();
      expect(db.policyDocument.update).not.toHaveBeenCalled();
      expect(db.policyDocument.create).not.toHaveBeenCalled();
      expect(db.policyPaperlessTag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { syncStatus: 'ERROR', syncErrorCode: 'SYNC_FAILED' },
        }),
      );
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', errorCode: 'SYNC_FAILED' }),
        }),
      );
    });

    it('never moves assignments when the Paperless connection changed', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(
        config({ connectionRef: 'https://old-paperless.example.com' }),
      );

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(true);
      expect(client.getTag).not.toHaveBeenCalled();
      expect(db.policyDocument.create).not.toHaveBeenCalled();
      expect(db.policyDocument.update).not.toHaveBeenCalled();
      expect(db.policyPaperlessTag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { syncStatus: 'ERROR', syncErrorCode: 'CONNECTION_CHANGED' },
        }),
      );
    });

    it('bounds retries and finally marks the job as failed', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow({ retryCount: 3, maxRetries: 3 }));
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue(null);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', errorCode: 'SYNC_FAILED' }),
        }),
      );
    });
  });

  describe('successful reconciliation', () => {
    it('adds tag documents, marks the sync active and backfills manual links', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 100, title: 'Police 2026' },
      ]);
      // One existing manual link without the tag origin, one tag-only row
      // that lost the tag, one manual link that lost the tag.
      db.policyDocument.findMany
        .mockResolvedValueOnce([
          {
            id: 'doc-manual',
            storageRef: '100',
            linkOriginManual: true,
            linkOriginTag: false,
            // BugFix-21: user values of a manual link (title, no date, no type).
            fileName: 'Police 2026',
            documentDate: null,
            mimeType: null,
          },
          { id: 'doc-lost-tag-only', storageRef: '200', linkOriginManual: false, linkOriginTag: true },
          { id: 'doc-lost-manual', storageRef: '300', linkOriginManual: true, linkOriginTag: true },
        ])
        // backfill query
        .mockResolvedValueOnce([{ id: 'doc-manual' }]);
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-backfill' });

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(true);
      // The manual link with the fresh remote tag gains the automatic origin.
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-manual' },
          data: { linkOriginTag: true },
        }),
      );
      // The tag-only row is archived, never hard-deleted.
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-lost-tag-only' },
          data: expect.objectContaining({ linkOriginTag: false }),
        }),
      );
      // A manual link that lost the tag keeps the manual origin.
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-lost-manual' },
          data: { linkOriginTag: false },
        }),
      );
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.not.objectContaining({
          where: { id: 'doc-lost-manual' },
          data: expect.objectContaining({ linkOriginManual: false }),
        }),
      );
      expect(db.policyDocument.create).not.toHaveBeenCalled();

      expect(db.policyPaperlessTag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            syncStatus: 'ACTIVE',
            syncErrorCode: null,
            paperlessTagName: 'KFZ',
          }),
        }),
      );
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      // Manual-link backfill: a durable job is queued for the manual link.
      expect(db.paperlessTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentId: 'doc-manual',
            kind: 'TAG_DOCUMENT',
            configVersion: 3,
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'tag-document',
        { jobId: 'job-backfill', policyId },
        expect.anything(),
      );
    });

    it('backfills manual links with a null-safe status filter (round-1 regression)', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([]);
      // First findMany = reconcile of local links, second = backfill query.
      db.policyDocument.findMany.mockResolvedValue([]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      const backfill = db.policyDocument.findMany.mock.calls.at(-1)?.[0];
      // Rows whose taggingStatus is NULL (linked before a tag existed) must
      // not be dropped by SQL null semantics.
      expect(backfill.where.OR).toEqual([
        { taggingStatus: null },
        { taggingStatus: { not: 'APPLIED' } },
      ]);
    });

    it('creates a new TAG-origin link for an unknown remote document', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([{ paperlessId: 500, title: 'Neu' }]);
      db.policyDocument.findMany.mockResolvedValue([]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            policyId,
            storageType: 'PAPERLESS_LINK',
            storageRef: '500',
            linkOriginTag: true,
            linkOriginManual: false,
          }),
        }),
      );
    });

    it('resolves a parallel create race idempotently (P2002)', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([{ paperlessId: 500, title: 'Neu' }]);
      db.policyDocument.findMany.mockResolvedValue([]);
      db.policyDocument.create.mockRejectedValue({ code: 'P2002' });

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(true);
      expect(db.policyDocument.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ storageRef: '500' }),
          data: { linkOriginTag: true },
        }),
      );
    });
  });

  describe('BugFix-21 document metadata', () => {
    it('stores date and MIME type of a newly assigned document', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        {
          paperlessId: 500,
          title: 'Police 2026',
          createdAt: '2026-01-15T00:00:00Z',
          mimeType: 'application/pdf',
        },
      ]);
      db.policyDocument.findMany.mockResolvedValue([]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storageRef: '500',
            fileName: 'Police 2026',
            mimeType: 'application/pdf',
            documentDate: new Date('2026-01-15T00:00:00Z'),
          }),
        }),
      );
    });

    it('falls back to a generic file name when Paperless has no title', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 500, title: '   ', createdAt: null, mimeType: null },
      ]);
      db.policyDocument.findMany.mockResolvedValue([]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fileName: 'Paperless document 500' }),
        }),
      );
    });

    it('refreshes date and MIME type of an automatically managed document', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        {
          paperlessId: 100,
          title: 'Police 2026 (neu)',
          createdAt: '2026-02-01T00:00:00Z',
          mimeType: 'application/pdf',
        },
      ]);
      db.policyDocument.findMany.mockResolvedValueOnce([
        {
          id: 'doc-auto',
          storageRef: '100',
          linkOriginManual: false,
          linkOriginTag: true,
          fileName: 'Police 2026',
          documentDate: null,
          mimeType: null,
        },
      ]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      const update = updateFor('doc-auto');
      expect(update?.data).toMatchObject({
        fileName: 'Police 2026 (neu)',
        mimeType: 'application/pdf',
      });
      expect((update?.data.documentDate as Date).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('never overwrites user-edited metadata of a manual link', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        {
          paperlessId: 100,
          title: 'Paperless-Titel',
          createdAt: '2026-02-01T00:00:00Z',
          mimeType: 'application/pdf',
        },
      ]);
      db.policyDocument.findMany.mockResolvedValueOnce([
        {
          id: 'doc-manual',
          storageRef: '100',
          linkOriginManual: true,
          linkOriginTag: true,
          fileName: 'Mein eigener Name',
          documentDate: new Date('2020-05-05T00:00:00.000Z'),
          mimeType: 'image/png',
        },
      ]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      // No metadata write at all – only the (already set) tag origin.
      expect(updateFor('doc-manual')).toBeUndefined();
      expect(db.policyDocument.create).not.toHaveBeenCalled();
    });

    it('fills only genuinely missing metadata of a manual link', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        {
          paperlessId: 100,
          title: 'Paperless-Titel',
          createdAt: '2026-02-01T00:00:00Z',
          mimeType: 'application/pdf',
        },
      ]);
      db.policyDocument.findMany.mockResolvedValueOnce([
        {
          id: 'doc-manual',
          storageRef: '100',
          linkOriginManual: true,
          linkOriginTag: true,
          fileName: 'Mein eigener Name',
          documentDate: null,
          mimeType: null,
        },
      ]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      const update = updateFor('doc-manual');
      expect(update?.data).toMatchObject({ mimeType: 'application/pdf' });
      expect(update?.data.fileName).toBeUndefined();
      expect(update?.data.linkOriginTag).toBeUndefined();
    });
  });

  describe('TAG_DOCUMENT', () => {
    it('confirms a verified assignment', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(
        syncJobRow({ kind: 'TAG_DOCUMENT', documentId: 'doc-1' }),
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      db.policyDocument.findFirst.mockResolvedValue({
        id: 'doc-1',
        storageType: 'PAPERLESS_LINK',
        storageRef: '100',
      });

      const result = await processor.process(job('tag-document', { jobId: 'job-1', policyId }));

      expect(client.assignTagToDocument).toHaveBeenCalledWith(100, 7);
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { taggingStatus: 'APPLIED', taggingErrorCode: null },
        }),
      );
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('round-4 fix: never assigns on a foreign server after a connection change', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(
        syncJobRow({ kind: 'TAG_DOCUMENT', documentId: 'doc-1' }),
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      // The admin repointed PAPERLESS_URL after this row was queued.
      client.baseUrl.mockResolvedValue('https://other-paperless.example.com');

      const result = await processor.process(job('tag-document', { jobId: 'job-1', policyId }));

      expect(client.assignTagToDocument).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SKIPPED',
            errorCode: 'CONNECTION_CHANGED',
          }),
        }),
      );
      expect(db.policyPaperlessTag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            syncStatus: 'ERROR',
            syncErrorCode: 'CONNECTION_CHANGED',
          }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('does not claim success when the assignment could not be verified', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(
        syncJobRow({ kind: 'TAG_DOCUMENT', documentId: 'doc-1' }),
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      db.policyDocument.findFirst.mockResolvedValue({
        id: 'doc-1',
        storageType: 'PAPERLESS_LINK',
        storageRef: '100',
      });
      client.assignTagToDocument.mockResolvedValue({
        success: false,
        verified: false,
        errorCode: 'VERIFY_FAILED',
      });

      await processor.process(job('tag-document', { jobId: 'job-1', policyId }));

      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { taggingStatus: 'PENDING', taggingErrorCode: 'VERIFY_FAILED' },
        }),
      );
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', errorCode: 'VERIFY_FAILED' }),
        }),
      );
    });

    it('fails permanently on a non-retryable error', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(
        syncJobRow({ kind: 'TAG_DOCUMENT', documentId: 'doc-1' }),
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      db.policyDocument.findFirst.mockResolvedValue({
        id: 'doc-1',
        storageType: 'PAPERLESS_LINK',
        storageRef: '100',
      });
      client.assignTagToDocument.mockResolvedValue({
        success: false,
        verified: false,
        errorCode: 'DOCUMENT_NOT_FOUND',
      });

      const result = await processor.process(job('tag-document', { jobId: 'job-1', policyId }));

      expect(result.success).toBe(false);
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { taggingStatus: 'FAILED', taggingErrorCode: 'DOCUMENT_NOT_FOUND' },
        }),
      );
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('skips a job whose linked document is gone', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(
        syncJobRow({ kind: 'TAG_DOCUMENT', documentId: 'doc-1' }),
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      db.policyDocument.findFirst.mockResolvedValue(null);

      await processor.process(job('tag-document', { jobId: 'job-1', policyId }));

      expect(client.assignTagToDocument).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'DOCUMENT_GONE' }),
        }),
      );
    });
  });

  describe('reconcile tick', () => {
    it('re-dispatches PENDING outbox rows and schedules due policies', async () => {
      db.paperlessTagJob.findMany.mockResolvedValue([
        { id: 'job-pending', policyId, kind: 'SYNC_POLICY' },
      ]);
      db.policyPaperlessTag.findMany.mockResolvedValue([
        { policyId, configVersion: 3 },
      ]);
      db.paperlessTagJob.findFirst.mockResolvedValue(null);
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-new' });

      await processor.process(job('reconcile', {}));

      expect(queue.add).toHaveBeenCalledWith(
        'sync-policy',
        { jobId: 'job-pending', policyId },
        expect.anything(),
      );
      expect(db.paperlessTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'SYNC_POLICY', configVersion: 3 }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'sync-policy',
        { jobId: 'job-new', policyId },
        expect.anything(),
      );
    });

    it('does not schedule a second sync while one is still active', async () => {
      db.paperlessTagJob.findMany.mockResolvedValue([]);
      db.policyPaperlessTag.findMany.mockResolvedValue([{ policyId, configVersion: 3 }]);
      db.paperlessTagJob.findFirst.mockResolvedValue({ id: 'job-active', status: 'RUNNING' });

      await processor.process(job('reconcile', {}));

      expect(db.paperlessTagJob.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('uses the configured sync interval to decide whether a policy is due', async () => {
      settings.getEffectiveNumber.mockResolvedValue(60_000);
      db.paperlessTagJob.findMany.mockResolvedValue([]);
      db.policyPaperlessTag.findMany.mockResolvedValue([]);

      await processor.process(job('reconcile', {}));

      expect(settings.getEffectiveNumber).toHaveBeenCalledWith('PAPERLESS_TAG_SYNC_INTERVAL_MS');
      const where = db.policyPaperlessTag.findMany.mock.calls[0][0].where;
      // Archived insurances are excluded from the periodic sync.
      expect(where.policy).toEqual({ archivedAt: null });
      const threshold = where.OR[1].lastSyncedAt.lt as Date;
      expect(Date.now() - threshold.getTime()).toBeGreaterThanOrEqual(59_000);
    });

    // AP-24 (§1.2): switching the background sync off stops *new* runs
    // without a restart, but must neither drop durable jobs nor abort
    // anything that is already queued.
    it('keeps re-dispatching durable jobs but schedules nothing new when disabled', async () => {
      settings.getEffectiveBoolean.mockResolvedValue(false);
      db.paperlessTagJob.findMany.mockResolvedValue([
        { id: 'job-pending', policyId, kind: 'SYNC_POLICY' },
      ]);
      db.policyPaperlessTag.findMany.mockResolvedValue([{ policyId, configVersion: 3 }]);

      await processor.process(job('reconcile', {}));

      expect(queue.add).toHaveBeenCalledWith(
        'sync-policy',
        { jobId: 'job-pending', policyId },
        expect.anything(),
      );
      // The due-check is not even performed.
      expect(db.policyPaperlessTag.findMany).not.toHaveBeenCalled();
      expect(db.paperlessTagJob.create).not.toHaveBeenCalled();
    });

    it('treats a missing enable flag as enabled (catalog default)', async () => {
      settings.getEffectiveBoolean.mockResolvedValue(undefined);
      db.paperlessTagJob.findMany.mockResolvedValue([]);
      db.policyPaperlessTag.findMany.mockResolvedValue([{ policyId, configVersion: 3 }]);
      db.paperlessTagJob.findFirst.mockResolvedValue(null);
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-new' });

      await processor.process(job('reconcile', {}));

      expect(db.paperlessTagJob.create).toHaveBeenCalledTimes(1);
    });

    // AP-24 (§1.2): insurances that became due in the same tick must not all
    // start at the same instant.
    it('staggers the start time by the deterministic per-policy offset', async () => {
      const intervalMs = 300_000;
      const stagger = paperlessTagSyncStaggerMs(policyId, intervalMs);
      settings.getEffectiveNumber.mockResolvedValue(intervalMs);
      db.paperlessTagJob.findMany.mockResolvedValue([]);
      db.paperlessTagJob.findFirst.mockResolvedValue(null);
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-new' });

      // Just inside the interval: the stagger has not elapsed yet.
      db.policyPaperlessTag.findMany.mockResolvedValue([
        {
          policyId,
          configVersion: 3,
          lastSyncedAt: new Date(Date.now() - intervalMs - stagger + 5_000),
        },
      ]);
      await processor.process(job('reconcile', {}));
      expect(db.paperlessTagJob.create).not.toHaveBeenCalled();

      // Past interval + stagger: now the policy is really due.
      db.paperlessTagJob.create.mockClear();
      db.policyPaperlessTag.findMany.mockResolvedValue([
        {
          policyId,
          configVersion: 3,
          lastSyncedAt: new Date(Date.now() - intervalMs - stagger - 5_000),
        },
      ]);
      await processor.process(job('reconcile', {}));
      expect(db.paperlessTagJob.create).toHaveBeenCalledTimes(1);
    });
  });

  it('returns an error result for an unknown job name', async () => {
    const result = await processor.process(job('unknown', {}));

    expect(result.success).toBe(false);
    expect(result.error).toBe('UNKNOWN_JOB');
  });

  // AP-24 (§2.2/§2.3): the document class belongs to Insura, not to
  // Paperless. A reconciliation may add/update/archive link rows, but it
  // must never write `documentClass` – otherwise a sync would silently
  // throw away a user's classification.
  describe('AP-24 §2: classification survives the tag sync', () => {
    /** Every write the processor performs against policy_documents. */
    function documentWrites() {
      return [
        ...db.policyDocument.update.mock.calls.map((c: unknown[]) => c[0]),
        ...db.policyDocument.updateMany.mock.calls.map((c: unknown[]) => c[0]),
        ...db.policyDocument.create.mock.calls.map((c: unknown[]) => c[0]),
      ] as { data?: Record<string, unknown> }[];
    }

    it('never writes documentClass while reconciling', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 100, title: 'Police 2026' },
      ]);
      db.policyDocument.findMany
        // Existing rows: one already classified (must survive), one to update.
        .mockResolvedValueOnce([
          {
            id: 'doc-classified',
            storageRef: '100',
            linkOriginManual: true,
            linkOriginTag: false,
            fileName: 'Police 2026',
            documentDate: null,
            mimeType: null,
            documentClass: 'BILLING',
          },
          {
            id: 'doc-lost-tag-only',
            storageRef: '200',
            linkOriginManual: false,
            linkOriginTag: true,
          },
        ])
        // Backfill query for manual links.
        .mockResolvedValueOnce([]);
      db.policyDocument.create.mockResolvedValue({ id: 'doc-new' });

      const result = await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));
      expect(result.success).toBe(true);

      // The classified row is touched (origin update)…
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'doc-classified' } }),
      );
      // …but no write of any kind carries the classification.
      const writes = documentWrites();
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        expect(write.data ?? {}).not.toHaveProperty('documentClass');
      }
    });

    it('lets a freshly synced document fall back to the UNCLASSIFIED default', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 100, title: 'Police 2026' },
      ]);
      db.policyDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      db.policyDocument.create.mockResolvedValue({ id: 'doc-new' });

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ documentClass: expect.anything() }),
        }),
      );
    });
  });

  // AP-24 (§1.1): the UI polls these counters, so their lifecycle is a
  // contract, not an implementation detail.
  describe('progress counters (AP-24 §1.1)', () => {
    /** All `paperlessTagJob.update` payloads written during one run. */
    function jobUpdates(): Record<string, unknown>[] {
      return db.paperlessTagJob.update.mock.calls.map(
        (call: unknown[]) => (call[0] as { data: Record<string, unknown> }).data,
      );
    }

    it('clears the previous run and publishes the total when the run starts', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 1, title: 'A' },
        { paperlessId: 2, title: 'B' },
      ]);
      db.policyDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      const updates = jobUpdates();
      // The RUNNING transition must wipe the stale counters of an earlier run.
      expect(updates).toContainEqual(
        expect.objectContaining({
          status: 'RUNNING',
          processedCount: 0,
          totalCount: null,
          addedCount: 0,
          removedCount: 0,
          unchangedCount: 0,
        }),
      );
      // The total becomes known as soon as the remote list is in – before the
      // reconciliation walks it.
      expect(updates).toContainEqual({ totalCount: 2 });
    });

    it('persists added/unchanged counts together with the terminal state', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([
        { paperlessId: 1, title: 'Neu' },
        { paperlessId: 2, title: 'Unveraendert' },
      ]);
      db.policyDocument.findMany.mockResolvedValueOnce([
        {
          id: 'doc-existing',
          storageRef: '2',
          linkOriginManual: false,
          linkOriginTag: true,
          fileName: 'Unveraendert',
          documentDate: null,
          mimeType: null,
        },
      ]);
      db.policyDocument.create.mockResolvedValue({ id: 'doc-new' });

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            addedCount: 1,
            removedCount: 0,
            unchangedCount: 1,
            processedCount: 2,
          }),
        }),
      );
    });

    it('counts removed links when the tag membership shrank', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue([]);
      db.policyDocument.findMany.mockResolvedValueOnce([
        {
          id: 'doc-lost',
          storageRef: '99',
          linkOriginManual: false,
          linkOriginTag: true,
          fileName: 'Alt',
          documentDate: null,
          mimeType: null,
        },
      ]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETED',
            removedCount: 1,
            addedCount: 0,
            unchangedCount: 0,
            processedCount: 0,
          }),
        }),
      );
    });

    it('flushes the intermediate count during the walk without one write per document', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      // 25 remote documents: the stride of 10 flushes 10 and 20, the final
      // values are written with the COMPLETED update.
      client.listDocumentsByTag.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ paperlessId: i + 1, title: `Doc ${i + 1}` })),
      );
      db.policyDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      db.policyDocument.create.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (args: any) => Promise.resolve({ id: `doc-${args.data.storageRef}` }),
      );

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      const progressWrites = jobUpdates().filter(
        (data) => 'processedCount' in data && !('status' in data),
      );
      expect(progressWrites.map((d) => d.processedCount)).toEqual([10, 20]);
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', processedCount: 25 }),
        }),
      );
    });

    it('keeps the partial counts when the configuration changes mid-run', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique
        .mockResolvedValueOnce(config()) // pre-flight version check
        .mockResolvedValue(config({ configVersion: 4 })); // changed during the walk
      client.listDocumentsByTag.mockResolvedValue([{ paperlessId: 1, title: 'A' }]);
      db.policyDocument.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      // The run is superseded, not completed – but the progress made so far
      // must still be visible instead of showing a reset row.
      expect(db.paperlessTagJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'STALE_CONFIG' }),
        }),
      );
      expect(db.paperlessTagJob.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('leaves the total unknown when the remote list cannot be fetched', async () => {
      db.paperlessTagJob.findUnique.mockResolvedValue(syncJobRow());
      db.policyPaperlessTag.findUnique.mockResolvedValue(config());
      client.listDocumentsByTag.mockResolvedValue(null);

      await processor.process(job('sync-policy', { jobId: 'job-1', policyId }));

      // No fabricated total: totalCount may only ever be null here.
      const totals = jobUpdates()
        .filter((d) => 'totalCount' in d)
        .map((d) => d.totalCount);
      expect(totals).toEqual([null]);
      // …and therefore no percentage-like processed counter either.
      expect(
        jobUpdates().filter((d) => typeof d.processedCount === 'number' && d.processedCount > 0),
      ).toEqual([]);
    });
  });
});
