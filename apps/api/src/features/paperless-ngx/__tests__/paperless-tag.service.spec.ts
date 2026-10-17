import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadGatewayException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';
import { PaperlessTagService } from '../paperless-tag.service';
import type { AuthenticatedUser } from '../../identity/auth.service';

/**
 * AP-22: unit tests for the per-policy Paperless tag configuration and the
 * durable (outbox) enqueueing. The external sync itself is covered by the
 * worker processor tests.
 */

const householdId = '11111111-1111-4111-1111-111111111111';
const userId = '22222222-2222-4222-2222-222222222222';
const policyId = '33333333-3333-4333-3333-333333333333';

const user: AuthenticatedUser = {
  id: userId,
  username: 'user-1',
  displayName: 'User 1',
  role: GlobalRole.USER,
  status: UserStatus.ACTIVE,
  memberships: [{ householdId }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDb(): any {
  const db: Record<string, unknown> = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyDocument: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    policyPaperlessTag: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    paperlessTagJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockQueue(): any {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockAuth(): any {
  return { assertPolicyReadAccess: vi.fn().mockResolvedValue(undefined) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockSettings(url = 'https://paperless.example.com/'): any {
  return {
    getEffectiveString: vi.fn().mockResolvedValue(url),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockPaperless(): any {
  return {
    searchTags: vi.fn().mockResolvedValue({ ok: true, page: { items: [], page: 1, pageCount: 0 } }),
    getTag: vi.fn().mockResolvedValue({ ok: true, tag: { tagId: 7, name: 'KFZ-Versicherung' } }),
    createTag: vi.fn(),
    listDocumentsByTag: vi.fn(),
    assignTagToDocument: vi.fn(),
  };
}

describe('PaperlessTagService', () => {
  let db: ReturnType<typeof createMockDb>;
  let queue: ReturnType<typeof createMockQueue>;
  let auth: ReturnType<typeof createMockAuth>;
  let settings: ReturnType<typeof createMockSettings>;
  let paperless: ReturnType<typeof createMockPaperless>;
  let service: PaperlessTagService;

  beforeEach(() => {
    db = createMockDb();
    queue = createMockQueue();
    auth = createMockAuth();
    settings = createMockSettings();
    paperless = createMockPaperless();
    db.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
    db.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
    service = new PaperlessTagService(db, auth, settings, paperless, queue);
  });

  describe('onModuleInit', () => {
    it('registers the repeatable reconciliation tick', async () => {
      await service.onModuleInit();
      expect(queue.add).toHaveBeenCalledWith(
        'reconcile',
        {},
        expect.objectContaining({ repeat: expect.objectContaining({ every: 60_000 }) }),
      );
    });

    it('does not fail startup when Redis is unavailable', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('searchTags / createTag', () => {
    it('searches tags server-side for a household member', async () => {
      paperless.searchTags.mockResolvedValue({
        ok: true,
        page: { items: [{ tagId: 7, name: 'KFZ' }], page: 1, pageCount: 1 },
      });

      const result = await service.searchTags(householdId, user, 'KFZ', 1);

      expect(paperless.searchTags).toHaveBeenCalledWith('KFZ', 1, 20);
      expect(result.items).toEqual([{ tagId: 7, name: 'KFZ' }]);
    });

    it('denies tag search for a foreign household (isolation)', async () => {
      db.householdMembership.findUnique.mockResolvedValue(null);

      await expect(service.searchTags('other-household', user, 'KFZ', 1)).rejects.toThrow(
        ForbiddenException,
      );
      expect(paperless.searchTags).not.toHaveBeenCalled();
    });

    it('surfaces why a tag search failed instead of returning an empty list', async () => {
      paperless.searchTags.mockResolvedValue({ ok: false, error: { kind: 'UNREACHABLE' } });

      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        'PAPERLESS_UNREACHABLE',
      );

      paperless.searchTags.mockResolvedValue({ ok: false, error: { kind: 'AUTH_FAILED' } });
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        BadGatewayException,
      );
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        'PAPERLESS_AUTH_FAILED',
      );

      paperless.searchTags.mockResolvedValue({ ok: false, error: { kind: 'NOT_CONFIGURED' } });
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        'PAPERLESS_NOT_CONFIGURED',
      );

      paperless.searchTags.mockResolvedValue({ ok: false, error: { kind: 'REJECTED' } });
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        BadGatewayException,
      );
      await expect(service.searchTags(householdId, user, 'KFZ', 1)).rejects.toThrow(
        'PAPERLESS_TAG_SEARCH_FAILED',
      );
    });

    it('returns the existing tag idempotently on create', async () => {
      paperless.createTag.mockResolvedValue({ ok: true, tag: { tagId: 7, name: 'KFZ' } });

      await expect(service.createTag(householdId, user, 'KFZ')).resolves.toEqual({
        tagId: 7,
        name: 'KFZ',
      });
    });

    it('reports a gateway error when the tag could not be created', async () => {
      paperless.createTag.mockResolvedValue({ ok: false, error: { kind: 'REJECTED' } });

      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        BadGatewayException,
      );
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        'PAPERLESS_TAG_CREATE_FAILED',
      );
    });

    it('names the cause when Paperless is missing, unreachable or rejecting', async () => {
      paperless.createTag.mockResolvedValue({ ok: false, error: { kind: 'NOT_CONFIGURED' } });
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        'PAPERLESS_NOT_CONFIGURED',
      );

      paperless.createTag.mockResolvedValue({ ok: false, error: { kind: 'AUTH_FAILED' } });
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        BadGatewayException,
      );
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        'PAPERLESS_AUTH_FAILED',
      );

      paperless.createTag.mockResolvedValue({ ok: false, error: { kind: 'UNREACHABLE' } });
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.createTag(householdId, user, 'KFZ')).rejects.toThrow(
        'PAPERLESS_UNREACHABLE',
      );
    });
  });

  describe('getConfig', () => {
    it('resolves the connection reference from settings for the config view', async () => {
      const settings = createMockSettings('https://paperless.example.com/');
      const svc = new PaperlessTagService(
        db,
        auth,
        settings,
        paperless,
        queue,
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue({
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ',
        configVersion: 1,
        lastSyncedAt: null,
        syncStatus: 'PENDING',
        syncErrorCode: null,
        connectionRef: 'https://paperless.example.com',
      });

      const config = await svc.getConfig(householdId, user, policyId);

      expect(config?.connection).toBe('https://paperless.example.com');
      expect(config?.connectionChanged).toBe(false);
    });

    it('returns null for an unconfigured policy (frontend treats it as "no tag")', async () => {
      const settings = createMockSettings();
      const svc = new PaperlessTagService(
        db,
        auth,
        settings,
        paperless,
        queue,
      );
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);

      await expect(svc.getConfig(householdId, user, policyId)).resolves.toBeNull();
    });
  });

  describe('setTag', () => {
    it('stores the configuration, bumps the version, supersedes old jobs and enqueues a sync', async () => {
      const saved = {
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ-Versicherung',
        configVersion: 2,
        lastSyncedAt: null,
        syncStatus: 'PENDING',
        syncErrorCode: null,
      };
      db.policyPaperlessTag.findUnique.mockResolvedValue({ id: 'cfg-1', configVersion: 1 });
      db.policyPaperlessTag.update.mockResolvedValue(saved);
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });

      const result = await service.setTag(householdId, userId, policyId, 7, 'stale-client-name');

      // The authoritative name comes from Paperless, not from the client.
      expect(db.policyPaperlessTag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { policyId },
          data: expect.objectContaining({
            paperlessTagId: 7,
            paperlessTagName: 'KFZ-Versicherung',
            connectionRef: 'https://paperless.example.com',
            configVersion: { increment: 1 },
            syncStatus: 'PENDING',
          }),
        }),
      );
      expect(db.paperlessTagJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'SUPERSEDED' }),
        }),
      );
      expect(db.paperlessTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'SYNC_POLICY',
            status: 'PENDING',
            configVersion: 2,
          }),
        }),
      );
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PAPERLESS_TAG_CHANGED' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'sync-policy',
        { jobId: 'job-1', policyId },
        expect.objectContaining({ jobId: 'job-1' }),
      );
      expect(result.configVersion).toBe(2);
    });

    it('resets already-applied manual links when the tag changes (round-2 fix)', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({
        id: 'cfg-1',
        paperlessTagId: 5, // old tag
        configVersion: 1,
      });
      db.policyPaperlessTag.update.mockResolvedValue({
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ-Versicherung',
        configVersion: 2,
        lastSyncedAt: null,
        syncStatus: 'PENDING',
        syncErrorCode: null,
      });
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });

      await service.setTag(householdId, userId, policyId, 7);

      // The new tag must be applied to links that were confirmed for the
      // previous tag, so they are put back to PENDING.
      expect(db.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { policyId, linkOriginManual: true, taggingStatus: 'APPLIED' },
        data: { taggingStatus: 'PENDING', taggingErrorCode: null },
      });
    });

    it('does not reset tagging status when the same tag is re-assigned', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({
        id: 'cfg-1',
        paperlessTagId: 7, // identical tag
        configVersion: 1,
      });
      db.policyPaperlessTag.update.mockResolvedValue({
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ-Versicherung',
        configVersion: 2,
        lastSyncedAt: null,
        syncStatus: 'PENDING',
        syncErrorCode: null,
      });
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });

      await service.setTag(householdId, userId, policyId, 7);

      expect(db.policyDocument.updateMany).not.toHaveBeenCalled();
    });

    it('creates the configuration for a policy without a tag', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);
      db.policyPaperlessTag.create.mockResolvedValue({
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ-Versicherung',
        configVersion: 1,
        lastSyncedAt: null,
        syncStatus: 'PENDING',
        syncErrorCode: null,
      });
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });

      await service.setTag(householdId, userId, policyId, 7);

      expect(db.policyPaperlessTag.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ configVersion: 1 }) }),
      );
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PAPERLESS_TAG_SET' }),
        }),
      );
    });

    it('verifies the tag against Paperless and rejects an unknown tag id', async () => {
      paperless.getTag.mockResolvedValue({ ok: false, error: { kind: 'NOT_FOUND' } });

      await expect(service.setTag(householdId, userId, policyId, 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(db.policyPaperlessTag.update).not.toHaveBeenCalled();
      expect(db.policyPaperlessTag.create).not.toHaveBeenCalled();
    });

    it('rejects assignment while Paperless is not configured', async () => {
      paperless.getTag.mockResolvedValue({ ok: false, error: { kind: 'NOT_CONFIGURED' } });

      await expect(service.setTag(householdId, userId, policyId, 7)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('keeps the DB change when the queue is unavailable (durable outbox)', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);
      db.policyPaperlessTag.create.mockResolvedValue({
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ-Versicherung',
        configVersion: 1,
        lastSyncedAt: null,
        syncStatus: 'PENDING',
        syncErrorCode: null,
      });
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.setTag(householdId, userId, policyId, 7)).resolves.toBeTruthy();
      expect(db.paperlessTagJob.create).toHaveBeenCalled();
    });
  });

  describe('removeTag', () => {
    it('archives tag-only documents and clears the automatic origin of manual links', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        configVersion: 3,
      });
      db.policyDocument.updateMany
        .mockResolvedValueOnce({ count: 2 }) // tag-only rows archived
        .mockResolvedValueOnce({ count: 1 }) // rows with both origins cleared
        .mockResolvedValueOnce({ count: 3 }); // manual-link tagging state reset

      const result = await service.removeTag(householdId, userId, policyId);

      expect(db.policyPaperlessTag.delete).toHaveBeenCalledWith({ where: { policyId } });
      expect(db.paperlessTagJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SKIPPED', errorCode: 'TAG_REMOVED' }),
        }),
      );
      // Documents that only existed because of the tag are archived.
      expect(db.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { policyId, linkOriginTag: true, linkOriginManual: false },
        data: { linkOriginTag: false, archivedAt: expect.any(Date) },
      });
      // Dual-origin rows keep the manual link – only the tag origin goes.
      expect(db.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { policyId, linkOriginTag: true, linkOriginManual: true },
        data: { linkOriginTag: false },
      });
      // Every remaining manual link loses its now-meaningless tagging state
      // (round-3 fix) – otherwise a stale PENDING/FAILED badge and a retry
      // button that fails with NO_PAPERLESS_TAG_CONFIGURED survive, and a
      // later re-assignment would skip an APPLIED link.
      expect(db.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { policyId, linkOriginManual: true, archivedAt: null },
        data: { taggingStatus: null, taggingErrorCode: null },
      });
      // Manual origin is never cleared by a tag removal.
      expect(db.policyDocument.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ linkOriginManual: false }) }),
      );
      expect(result.tagRemoved).toBe(true);
    });

    it('resets the tagging state of manual links that have no tag origin (round-3 fix)', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({
        id: 'cfg-1',
        policyId,
        paperlessTagId: 7,
        configVersion: 3,
      });
      db.policyDocument.updateMany
        .mockResolvedValueOnce({ count: 0 }) // no tag-only rows
        .mockResolvedValueOnce({ count: 0 }) // no dual-origin rows
        .mockResolvedValueOnce({ count: 2 }); // two manual links had a state

      await service.removeTag(householdId, userId, policyId);

      // The reset targets manual links regardless of linkOriginTag.
      const resetCall = db.policyDocument.updateMany.mock.calls[2][0];
      expect(resetCall.where).toEqual({ policyId, linkOriginManual: true, archivedAt: null });
      expect(resetCall.where.linkOriginTag).toBeUndefined();
      expect(resetCall.data).toEqual({ taggingStatus: null, taggingErrorCode: null });
    });

    it('is a no-op when no tag is configured', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);

      const result = await service.removeTag(householdId, userId, policyId);

      expect(result.tagRemoved).toBe(false);
      expect(db.policyDocument.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('requestSync', () => {
    it('schedules an immediate reconciliation for the current config version', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({ policyId, configVersion: 5 });
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-9' });

      const result = await service.requestSync(householdId, userId, policyId);

      expect(db.paperlessTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'SYNC_POLICY', configVersion: 5 }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'sync-policy',
        { jobId: 'job-9', policyId },
        expect.anything(),
      );
      expect(result.configVersion).toBe(5);
    });

    it('rejects a manual sync without a configured tag', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);

      await expect(service.requestSync(householdId, userId, policyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('retryTagging', () => {
    it('re-schedules only manually linked documents with a pending/failed assignment', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({ policyId, configVersion: 2 });
      db.policyDocument.findMany.mockResolvedValue([{ id: 'doc-1' }]);
      db.policyDocument.update.mockResolvedValue({});
      db.paperlessTagJob.create.mockResolvedValue({ id: 'job-2' });

      const result = await service.retryTagging(householdId, userId, policyId, 'doc-1');

      expect(db.policyDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            policyId,
            linkOriginManual: true,
            taggingStatus: { in: ['PENDING', 'FAILED'] },
            id: 'doc-1',
          }),
        }),
      );
      expect(db.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { taggingStatus: 'PENDING', taggingErrorCode: null },
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'tag-document',
        { jobId: 'job-2', policyId },
        expect.anything(),
      );
      expect(result.scheduled).toBe(1);
    });

    it('rejects retrying without a configured tag', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);

      await expect(service.retryTagging(householdId, userId, policyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStatus', () => {
    it('returns the tagging states and configuration snapshot', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue({
        policyId,
        paperlessTagId: 7,
        paperlessTagName: 'KFZ',
        configVersion: 1,
        lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
        syncStatus: 'ACTIVE',
        syncErrorCode: null,
      });
      db.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-1', fileName: 'a.pdf', taggingStatus: 'FAILED', taggingErrorCode: 'UNREACHABLE' },
      ]);
      db.paperlessTagJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'FAILED' });

      const result = await service.getStatus(householdId, user, policyId);

      expect(auth.assertPolicyReadAccess).toHaveBeenCalledWith(user, householdId, policyId);
      expect(result.configured).toBe(true);
      expect(result.taggingStates).toHaveLength(1);
    });

    it('reports unconfigured policies without leaking config fields', async () => {
      db.policyPaperlessTag.findUnique.mockResolvedValue(null);
      db.policyDocument.findMany.mockResolvedValue([]);
      db.paperlessTagJob.findFirst.mockResolvedValue(null);

      const result = await service.getStatus(householdId, user, policyId);

      expect(result.configured).toBe(false);
    });
  });
});
