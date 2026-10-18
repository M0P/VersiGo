import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentsService, MAX_FILE_SIZE, MAX_BULK_CLASSIFY } from '../documents.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { UploadedFile } from '../documents.types';
import { GlobalRole, UserStatus } from '@prisma/client';
import { AuthService } from '../../identity/auth.service';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn> };
    policyDocument: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
    // AP-22: tag configuration + durable outbox
    policyPaperlessTag: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    paperlessTagJob: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyDocument: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      // Realistic default: a Prisma `update` returns the updated row.
      update: vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ id: args.where.id, ...args.data }),
      ),
      delete: vi.fn(),
      // AP-24 (§2): bulk classification writes with a single `updateMany`.
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditEvent: { create: vi.fn() },
    policyPaperlessTag: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    paperlessTagJob: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
}

/** AP-22: mock of the PaperlessTagService (durable job enqueue). */
function createMockPaperlessTags() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

function createMockConfig() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'DOCUMENTS_STORAGE_PATH') return '/tmp/uploads';
      return undefined;
    }),
  };
}

type MockDb = ReturnType<typeof createMockDb>;

// BugFix-07 (Q3): mock of the PAPERLESS_ADAPTER.
function createMockPaperless() {
  return {
    getDeepLink: vi.fn().mockResolvedValue('https://paperless.example.com/documents/42/'),
    getDocumentMetadata: vi.fn(),
    syncDocument: vi.fn(),
    searchDocuments: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(false),
    // AP-22: tag catalogue (not used by DocumentsService).
    searchTags: vi.fn().mockResolvedValue({ ok: true, page: { items: [], page: 1, pageCount: 0 } }),
    getTag: vi.fn(),
    createTag: vi.fn(),
    listDocumentsByTag: vi.fn(),
    assignTagToDocument: vi.fn(),
  };
}

const mockFile: UploadedFile = {
  fieldname: 'file',
  originalname: 'test.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 test content'),
  size: 22,
  destination: '',
  filename: '',
  path: '',
};

describe('DocumentsService', () => {
  let mockDb: MockDb;
  let service: DocumentsService;
  const householdId = '11111111-1111-4111-1111-111111111111';
  const userId = '22222222-2222-4222-2222-222222222222';
  const policyId = '33333333-3333-4333-3333-333333333333';
  const docId = '44444444-4444-4444-4444-444444444444';
  const user = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };

  beforeEach(() => {
    mockDb = createMockDb();
    service = new DocumentsService(
      mockDb as never,
      createMockConfig() as never,
      new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
      createMockPaperless(),
      createMockPaperlessTags() as never,
    );
  });

  describe('upload', () => {
    it('uploads a document and logs an audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.create.mockResolvedValue({
        id: docId,
        policyId,
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        fileSize: 12,
        checksum: 'abc',
        storageType: 'INTERNAL',
        createdByUserId: userId,
      });
      mockDb.policyDocument.update.mockResolvedValue({
        id: docId,
        policyId,
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        storageRef: `/tmp/uploads/${policyId}/${docId}/${docId}`,
      });

      const result = await service.upload(householdId, userId, policyId, mockFile, { category: 'vertrag' });

      expect(result!.fileName).toBe('test.pdf');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'PolicyDocument',
            action: 'CREATE',
          }),
        }),
      );
    });

    it('refuses upload without household membership', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.upload(householdId, userId, policyId, mockFile, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses upload when the policy is missing', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(householdId, userId, policyId, mockFile, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses upload for a disallowed MIME type', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      const invalidFile = { ...mockFile, mimetype: 'application/x-sh' };

      await expect(
        service.upload(householdId, userId, policyId, invalidFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses upload when the checksum already exists', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: 'existing', policyId, checksum: 'abc' });

      await expect(
        service.upload(householdId, userId, policyId, mockFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses upload for a file that is too large', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      const oversizedFile = { ...mockFile, size: MAX_FILE_SIZE + 1 };

      await expect(
        service.upload(householdId, userId, policyId, oversizedFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses upload for a filename that is too long', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      const longNameFile = { ...mockFile, originalname: 'a'.repeat(256) };

      await expect(
        service.upload(householdId, userId, policyId, longNameFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('cleans up when storeFile fails', async () => {
      const { writeFile } = await import('fs/promises');
      const writeFileMock = writeFile as ReturnType<typeof vi.fn>;
      writeFileMock.mockRejectedValue(new Error('Disk full'));

      try {
        mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
        mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
        mockDb.policyDocument.findFirst.mockResolvedValue(null);
        mockDb.policyDocument.create.mockResolvedValue({
          id: docId, policyId, fileName: 'test.pdf',
          mimeType: 'application/pdf', fileSize: 12,
          checksum: 'abc', storageType: 'INTERNAL',
          createdByUserId: userId,
        });
        mockDb.policyDocument.delete.mockResolvedValue(undefined);

        await expect(
          service.upload(householdId, userId, policyId, mockFile, {}),
        ).rejects.toThrow('Disk full');

        expect(mockDb.policyDocument.delete).toHaveBeenCalledWith({ where: { id: docId } });
      } finally {
        // The `fs/promises` module mock is shared by this whole file and is
        // not reset between tests – without restoring it every later upload
        // would fail with "Disk full" too.
        writeFileMock.mockResolvedValue(undefined);
      }
    });
  });

  describe('findAll', () => {
    it('returns all non-archived documents of a policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'd1', policyId, fileName: 'a.pdf' },
        { id: 'd2', policyId, fileName: 'b.pdf' },
      ]);

      const result = await service.findAll(householdId, user, policyId);

      expect(result).toHaveLength(2);
      expect(mockDb.policyDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId, archivedAt: null }, take: 200 }),
      );
    });

    // BugFix-07 (Q3): PAPERLESS_LINK documents get a deep link.
    it('adds the Paperless deep link for PAPERLESS_LINK documents', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'd1', policyId, fileName: 'intern.pdf', storageType: 'INTERNAL', storageRef: null },
        { id: 'd2', policyId, fileName: 'paperless.pdf', storageType: 'PAPERLESS_LINK', storageRef: '42' },
      ]);

      const result = await service.findAll(householdId, user, policyId);

      expect(result[0]).not.toHaveProperty('deepLink');
      expect(result[1]).toMatchObject({ storageType: 'PAPERLESS_LINK', deepLink: 'https://paperless.example.com/documents/42/' });
    });
  });

  describe('linkPaperlessDocument (BugFix-07, Q3)', () => {
    it('links a Paperless document as PAPERLESS_LINK and audits', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title: 'KFZ-Versicherung 2026',
        tags: [],
        correspondent: 'Muster Versicherung',
        documentType: 'Vertrag',
        notes: null,
        createdAt: '2026-01-15T10:00:00.000Z',
        modifiedAt: null,
        // BugFix-21: the MIME type is persisted so the UI can show a
        // document-type icon without querying Paperless again.
        mimeType: 'application/pdf',
      });
      const serviceWithPaperless = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless,
        createMockPaperlessTags() as never,
      );
      mockDb.policyDocument.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.create.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        fileName: 'KFZ-Versicherung 2026',
        storageRef: '42',
        category: 'Vertrag',
        documentDate: new Date('2026-01-15T10:00:00.000Z'),
      });

      const result = await serviceWithPaperless.linkPaperlessDocument(
        householdId,
        userId,
        policyId,
        42,
      );

      expect(paperless.getDocumentMetadata).toHaveBeenCalledWith(42);
      expect(mockDb.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            policyId,
            storageType: 'PAPERLESS_LINK',
            storageRef: '42',
            category: 'Vertrag',
            // BugFix-21: MIME type from Paperless (drives the type icon).
            mimeType: 'application/pdf',
          }),
        }),
      );
      expect(result.id).toBe('link-1');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PAPERLESS_LINK_CREATED' }),
        }),
      );
    });

    it('persists no document date when Paperless reports an unusable one (BugFix-21 review #3)', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title: 'KFZ-Versicherung 2026',
        tags: [],
        correspondent: null,
        documentType: null,
        notes: null,
        createdAt: 'not-a-date',
        modifiedAt: null,
        mimeType: 'application/pdf',
      });
      const serviceWithPaperless = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless,
        createMockPaperlessTags() as never,
      );
      mockDb.policyDocument.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.create.mockResolvedValue({ id: 'link-1', policyId });

      await serviceWithPaperless.linkPaperlessDocument(householdId, userId, policyId, 42);

      // An invalid external date is dropped instead of being persisted.
      expect(mockDb.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ documentDate: null }),
        }),
      );
    });

    it('deduplicates: linking again returns the existing entry', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({ title: 'X', tags: [], correspondent: null, documentType: null, notes: null, createdAt: null, modifiedAt: null });
      const serviceWithPaperless = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless,
        createMockPaperlessTags() as never,
      );
      const existing = {
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        // AP-22: already recorded as a manual link – re-linking is a no-op.
        linkOriginManual: true,
      };
      mockDb.policyDocument.findFirst.mockResolvedValue(existing);

      const result = await serviceWithPaperless.linkPaperlessDocument(householdId, userId, policyId, 42);

      expect(result).toEqual(existing);
      expect(mockDb.policyDocument.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the document is missing in Paperless', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue(null);
      const serviceWithPaperless = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless,
        createMockPaperlessTags() as never,
      );

      await expect(
        serviceWithPaperless.linkPaperlessDocument(householdId, userId, policyId, 999),
      ).rejects.toThrow(NotFoundException);
      expect(mockDb.policyDocument.create).not.toHaveBeenCalled();
    });

    it('BugFix-07 (code review): a P2002 race between parallel links is resolved idempotently', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title: 'Rennen 2026',
        tags: [],
        correspondent: null,
        documentType: null,
        notes: null,
        createdAt: null,
        modifiedAt: null,
      });
      const serviceWithPaperless = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless,
        createMockPaperlessTags() as never,
      );

      // Check-then-insert: the first check (inside the transaction) finds
      // nothing; the parallel request wins the race and causes a P2002 on
      // create (partial unique index from the migration
      // 20260806140000_bugfix07_paperless_link_dedupe).
      const existing = {
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        // AP-22: already recorded as a manual link – re-linking is a no-op.
        linkOriginManual: true,
      };
      mockDb.policyDocument.findFirst
        .mockResolvedValueOnce(null) // transaction check: nothing present
        .mockResolvedValueOnce(existing); // P2002-Rueckgriff: Sieger gefunden
      mockDb.policyDocument.create.mockRejectedValue({ code: 'P2002' });

      const result = await serviceWithPaperless.linkPaperlessDocument(
        householdId,
        userId,
        policyId,
        42,
      );

      expect(result).toEqual(existing);
      expect(mockDb.policyDocument.create).toHaveBeenCalledTimes(1);
      // No second CREATE/audit for the losing writer.
      expect(mockDb.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the document is missing', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, user, policyId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns a document', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: docId, policyId, fileName: 'test.pdf' });

      const result = await service.findOne(householdId, user, policyId, docId);

      expect(result.id).toBe(docId);
    });
  });

  describe('updateMetadata', () => {
    it('updates metadata and logs an audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: docId, policyId, archivedAt: null });
      mockDb.policyDocument.update.mockResolvedValue({ id: docId, category: 'neu' });

      const result = await service.updateMetadata(householdId, userId, policyId, docId, { category: 'neu' });

      expect(result.category).toBe('neu');
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE' }),
        }),
      );
    });

    it('throws NotFoundException for an archived document', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMetadata(householdId, userId, policyId, docId, { category: 'neu' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('archives a document, deletes the file from disk and logs an audit', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: docId, policyId, archivedAt: null });
      mockDb.policyDocument.update.mockResolvedValue({ id: docId, archivedAt: new Date() });

      const result = await service.remove(householdId, userId, policyId, docId);

      expect(result.success).toBe(true);
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityId: docId,
            action: 'ARCHIVE',
          }),
        }),
      );

      const { unlink } = await import('fs/promises');
      expect(unlink).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`/tmp/uploads/${policyId}/${docId}/${docId}$`)),
      );
    });

    it('throws NotFoundException when the document is missing', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(householdId, userId, policyId, docId),
      ).rejects.toThrow(NotFoundException);
    });

    it('AP-22: only unlinks the manual origin when the document is also tag-assigned', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: docId,
        policyId,
        archivedAt: null,
        linkOriginManual: true,
        linkOriginTag: true,
      });
      mockDb.policyDocument.update.mockResolvedValue({ id: docId, linkOriginManual: false });

      const result = await service.remove(householdId, userId, policyId, docId);

      expect(result.success).toBe(true);
      // The row must survive – only the manual link is removed.
      expect(mockDb.policyDocument.update).toHaveBeenCalledWith({
        where: { id: docId },
        data: { linkOriginManual: false },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityId: docId, action: 'UNLINK_MANUAL' }),
        }),
      );
    });
  });

  describe('Household-Isolation', () => {
    it('refuses access without membership in findAll', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.findAll(householdId, user, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses access without membership in findOne', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, user, policyId, docId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses access without membership in updateMetadata', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMetadata(householdId, userId, policyId, docId, { category: 'neu' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses access without membership in remove', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(householdId, userId, policyId, docId),
      ).rejects.toThrow(ForbiddenException);
    });

    // Review round 2 (M2): these mocks answer whatever they are handed, so a
    // query that silently lost its scoping filter would still return rows and
    // the behavioural assertions above would keep passing. Pinning the actual
    // argument closes that hole.
    it('scopes the policy lookup used by access checks to id AND household', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      await service.getFilePath(householdId, userId, policyId, docId);

      expect(mockDb.insurancePolicy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: policyId, householdId } }),
      );
    });

    it('scopes the document lookup in findOne to id, policy and the non-archived set', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: docId, policyId, fileName: 'test.pdf' });

      await service.findOne(householdId, user, policyId, docId);

      expect(mockDb.policyDocument.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: docId, policyId, archivedAt: null } }),
      );
    });
  });

  // AP-22: manual links additionally receive the configured Paperless tag.
  describe('linkPaperlessDocument – tag assignment (AP-22)', () => {
    function setupPaperless(title = 'KFZ-Versicherung 2026') {
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title,
        tags: [],
        correspondent: null,
        documentType: null,
        notes: null,
        createdAt: null,
        modifiedAt: null,
      });
      return paperless;
    }

    function buildService(paperless: ReturnType<typeof createMockPaperless>, tags = createMockPaperlessTags()) {
      const svc = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless as never,
        tags as never,
      );
      return { svc, tags };
    }

    beforeEach(() => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);
    });

    it('fills missing metadata of an existing link when no tag is configured (BugFix-21 review #1)', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue(null);
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title: 'KFZ-Versicherung 2026',
        tags: [],
        correspondent: null,
        documentType: null,
        notes: null,
        createdAt: '2026-05-02T00:00:00.000Z',
        modifiedAt: null,
        mimeType: 'application/pdf',
      });
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        linkOriginManual: true,
        // Linked before the metadata sync existed – both fields are still NULL.
        mimeType: null,
        documentDate: null,
      });
      mockDb.policyDocument.update.mockResolvedValue({ id: 'link-1', policyId });
      const { svc, tags } = buildService(paperless);

      const result = await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      // Only the gaps are written; the user's own title/fileName is untouched.
      expect(mockDb.policyDocument.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: {
          mimeType: 'application/pdf',
          documentDate: new Date('2026-05-02T00:00:00.000Z'),
        },
      });
      expect(mockDb.policyDocument.create).not.toHaveBeenCalled();
      expect(tags.enqueue).not.toHaveBeenCalled();
      expect(result.id).toBe('link-1');
    });

    it('never overwrites metadata that is already present', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue(null);
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title: 'KFZ-Versicherung 2026',
        tags: [],
        correspondent: null,
        documentType: null,
        notes: null,
        createdAt: '2026-05-02T00:00:00.000Z',
        modifiedAt: null,
        mimeType: 'application/pdf',
      });
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        linkOriginManual: true,
        mimeType: 'image/png',
        documentDate: new Date('2020-01-01T00:00:00.000Z'),
      });
      const { svc } = buildService(paperless);

      await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      // Nothing to fill -> the idempotent path must not write at all.
      expect(mockDb.policyDocument.update).not.toHaveBeenCalled();
      expect(mockDb.policyDocument.create).not.toHaveBeenCalled();
    });

    it('skips an unusable Paperless date instead of persisting it (BugFix-21 review #2)', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue(null);
      const paperless = createMockPaperless();
      paperless.getDocumentMetadata.mockResolvedValue({
        title: 'KFZ-Versicherung 2026',
        tags: [],
        correspondent: null,
        documentType: null,
        notes: null,
        createdAt: 'not-a-date',
        modifiedAt: null,
        mimeType: 'application/pdf',
      });
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        linkOriginManual: true,
        mimeType: null,
        documentDate: null,
      });
      mockDb.policyDocument.update.mockResolvedValue({ id: 'link-1', policyId });
      const { svc } = buildService(paperless);

      await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      // The MIME type is filled, the unusable date is not written at all.
      expect(mockDb.policyDocument.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { mimeType: 'application/pdf' },
      });
    });

    it('records the manual origin but creates no job when no tag is configured', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue(null);
      mockDb.policyDocument.create.mockResolvedValue({ id: 'link-1', policyId });
      const { svc, tags } = buildService(setupPaperless());

      const result = await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      expect(mockDb.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkOriginManual: true }),
        }),
      );
      expect(mockDb.paperlessTagJob.create).not.toHaveBeenCalled();
      expect(tags.enqueue).not.toHaveBeenCalled();
      expect(result.id).toBe('link-1');
    });

    it('creates a durable TAG_DOCUMENT job and marks the tagging as pending when a tag exists', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue({ policyId, configVersion: 4 });
      mockDb.policyDocument.create.mockResolvedValue({ id: 'link-1', policyId });
      mockDb.paperlessTagJob.findFirst.mockResolvedValue(null);
      mockDb.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });
      const { svc, tags } = buildService(setupPaperless());

      await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      expect(mockDb.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1' },
          data: expect.objectContaining({ linkOriginManual: true, taggingStatus: 'PENDING' }),
        }),
      );
      expect(mockDb.paperlessTagJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            policyId,
            documentId: 'link-1',
            kind: 'TAG_DOCUMENT',
            status: 'PENDING',
            configVersion: 4,
          }),
        }),
      );
      // Enqueued only after the transaction committed.
      expect(tags.enqueue).toHaveBeenCalledWith('tag-document', 'job-1', policyId);
    });

    it('reuses an already pending assignment instead of creating a duplicate job', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue({ policyId, configVersion: 4 });
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        linkOriginManual: false,
        taggingStatus: 'PENDING',
      });
      mockDb.paperlessTagJob.findFirst.mockResolvedValue({ id: 'job-existing', status: 'PENDING' });
      const { svc, tags } = buildService(setupPaperless());

      const result = await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      expect(mockDb.paperlessTagJob.create).not.toHaveBeenCalled();
      expect(tags.enqueue).not.toHaveBeenCalled();
      expect(result.id).toBe('link-1');
    });

    it('round-5 fix: an APPLIED row is still re-assigned because the state is not tag-version aware', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue({ policyId, configVersion: 4 });
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        linkOriginManual: true,
        taggingStatus: 'APPLIED',
      });
      mockDb.paperlessTagJob.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.update.mockResolvedValue({ id: 'link-1' });
      mockDb.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });
      const { svc, tags } = buildService(setupPaperless());

      await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      // `APPLIED` only records that *some* earlier sync applied a tag; it does
      // not prove the currently configured tag is present (the manual origin
      // may have been dropped, in which case setTag's reset no longer matches
      // the row). The durable assignment is therefore queued again and the
      // worker's assignTagToDocument is the cheap no-op path.
      expect(mockDb.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1' },
          data: expect.objectContaining({ taggingStatus: 'PENDING' }),
        }),
      );
      expect(mockDb.paperlessTagJob.create).toHaveBeenCalled();
      expect(tags.enqueue).toHaveBeenCalledWith('tag-document', 'job-1', policyId);
    });

    it('round-4 fix: a tag-origin row is not assumed to carry the *current* tag', async () => {
      mockDb.policyPaperlessTag.findUnique.mockResolvedValue({ policyId, configVersion: 4 });
      // The row was created by a sync of some tag; that does not prove the
      // currently configured tag (or connection) is the same one.
      mockDb.policyDocument.findFirst.mockResolvedValue({
        id: 'link-1',
        policyId,
        storageType: 'PAPERLESS_LINK',
        storageRef: '42',
        linkOriginManual: false,
        linkOriginTag: true,
        taggingStatus: null,
      });
      mockDb.paperlessTagJob.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.update.mockResolvedValue({ id: 'link-1' });
      mockDb.paperlessTagJob.create.mockResolvedValue({ id: 'job-1' });
      const { svc, tags } = buildService(setupPaperless());

      await svc.linkPaperlessDocument(householdId, userId, policyId, 42);

      // The assignment is queued for the current tag; the worker's
      // assignTagToDocument is the cheap no-op path when the tag is present.
      expect(mockDb.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1' },
          data: expect.objectContaining({
            linkOriginManual: true,
            taggingStatus: 'PENDING',
          }),
        }),
      );
      expect(mockDb.paperlessTagJob.create).toHaveBeenCalled();
      expect(tags.enqueue).toHaveBeenCalledWith('tag-document', 'job-1', policyId);
    });
  });

  // --- AP-24 (§2): Dokumentklassifikation ----------------------------------

  describe('classifyDocuments (AP-24 §2.3)', () => {
    const docA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const docB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    function allowPolicyAccess() {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
    }

    it('reclassifies the given documents of the policy and audits the change', async () => {
      allowPolicyAccess();
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: docA, documentClass: 'UNCLASSIFIED' },
        { id: docB, documentClass: 'CONTRACT' },
      ]);
      mockDb.policyDocument.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.classifyDocuments(householdId, userId, policyId, {
        documentIds: [docA, docB],
        documentClass: 'BILLING',
      });

      expect(result).toEqual({ requested: 2, updated: 2, unchanged: 0, notFound: 0 });
      expect(mockDb.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [docA, docB] } },
        data: { documentClass: 'BILLING' },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'PolicyDocument',
          entityId: policyId,
          action: 'BULK_CLASSIFY',
          diffJson: expect.objectContaining({
            documentClass: 'BILLING',
            documentIds: [docA, docB],
            changed: 2,
          }),
        }),
      });
    });

    it('never touches documents of another household or unknown IDs', async () => {
      allowPolicyAccess();
      // The service scopes the lookup by policyId; only docA comes back.
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: docA, documentClass: 'UNCLASSIFIED' },
      ]);
      mockDb.policyDocument.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.classifyDocuments(householdId, userId, policyId, {
        documentIds: [docA, '99999999-9999-4999-8999-999999999999'],
        documentClass: 'CLAIM',
      });

      expect(mockDb.policyDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ policyId, archivedAt: null }),
        }),
      );
      expect(result.notFound).toBe(1);
      expect(result.updated).toBe(1);
      // The update is restricted to the verified document.
      expect(mockDb.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [docA] } },
        data: { documentClass: 'CLAIM' },
      });
    });

    it('does not write or audit anything when every document already has the class', async () => {
      allowPolicyAccess();
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: docA, documentClass: 'BILLING' },
      ]);

      const result = await service.classifyDocuments(householdId, userId, policyId, {
        documentIds: [docA],
        documentClass: 'BILLING',
      });

      expect(result).toEqual({ requested: 1, updated: 0, unchanged: 1, notFound: 0 });
      expect(mockDb.policyDocument.updateMany).not.toHaveBeenCalled();
      expect(mockDb.auditEvent.create).not.toHaveBeenCalled();
    });

    it('rejects a request above the bulk limit', async () => {
      allowPolicyAccess();
      const documentIds = Array.from(
        { length: MAX_BULK_CLASSIFY + 1 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );

      await expect(
        service.classifyDocuments(householdId, userId, policyId, {
          documentIds,
          documentClass: 'OTHER',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockDb.policyDocument.findMany).not.toHaveBeenCalled();
    });

    it('applies duplicated IDs only once', async () => {
      allowPolicyAccess();
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: docA, documentClass: 'UNCLASSIFIED' },
      ]);
      mockDb.policyDocument.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.classifyDocuments(householdId, userId, policyId, {
        documentIds: [docA, docA],
        documentClass: 'OTHER',
      });

      expect(result.requested).toBe(1);
      expect(mockDb.policyDocument.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [docA] } },
        data: { documentClass: 'OTHER' },
      });
    });
  });

  describe('document class filter and assignment (AP-24 §2)', () => {
    function allowReadAccess() {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
    }

    it('narrows the document list to the requested class', async () => {
      allowReadAccess();
      mockDb.policyDocument.findMany.mockResolvedValue([]);

      await service.findAll(householdId, user, policyId, 'BILLING');

      expect(mockDb.policyDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            policyId,
            archivedAt: null,
            documentClass: 'BILLING',
          }),
        }),
      );
    });

    it('keeps the previous unfiltered query when no class is given', async () => {
      allowReadAccess();
      mockDb.policyDocument.findMany.mockResolvedValue([]);

      await service.findAll(householdId, user, policyId);

      expect(mockDb.policyDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId, archivedAt: null } }),
      );
    });

    it('stores a class provided at upload time', async () => {
      allowReadAccess();
      mockDb.policyDocument.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.create.mockResolvedValue({ id: docId, policyId });
      mockDb.policyDocument.update.mockResolvedValue({ id: docId, policyId });

      await service.upload(householdId, userId, policyId, mockFile, {
        documentClass: 'CONTRACT',
      });

      expect(mockDb.policyDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ documentClass: 'CONTRACT' }),
        }),
      );
    });

    it('leaves the class at the database default when the upload picks none', async () => {
      allowReadAccess();
      mockDb.policyDocument.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.create.mockResolvedValue({ id: docId, policyId });
      mockDb.policyDocument.update.mockResolvedValue({ id: docId, policyId });

      await service.upload(householdId, userId, policyId, mockFile, {});

      // `undefined` is what tells Prisma to use the column default; sending
      // an explicit value here would silently overwrite it.
      const created = mockDb.policyDocument.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(created.data.documentClass).toBeUndefined();
    });

    it('updates the class in the document details and audits it', async () => {
      allowReadAccess();
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: docId, policyId });
      mockDb.policyDocument.update.mockResolvedValue({ id: docId, documentClass: 'CLAIM' });

      await service.updateMetadata(householdId, userId, policyId, docId, {
        documentClass: 'CLAIM',
      });

      expect(mockDb.policyDocument.update).toHaveBeenCalledWith({
        where: { id: docId },
        data: expect.objectContaining({ documentClass: 'CLAIM' }),
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          diffJson: expect.objectContaining({ documentClass: 'CLAIM' }),
        }),
      });
    });
  });
});
