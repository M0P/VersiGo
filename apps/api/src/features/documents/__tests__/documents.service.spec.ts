import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentsService, MAX_FILE_SIZE } from '../documents.service';
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
    policyDocument: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyDocument: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
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
      (writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Disk full'));

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
      });
      const serviceWithPaperless = new DocumentsService(
        mockDb as never,
        createMockConfig() as never,
        new AuthService(mockDb as never, { hash: vi.fn(), verify: vi.fn() } as never),
        paperless,
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
      );
      const existing = { id: 'link-1', policyId, storageType: 'PAPERLESS_LINK', storageRef: '42' };
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
      );

      // Check-then-insert: the first check (inside the transaction) finds
      // nothing; the parallel request wins the race and causes a P2002 on
      // create (partial unique index from the migration
      // 20260806140000_bugfix07_paperless_link_dedupe).
      const existing = { id: 'link-1', policyId, storageType: 'PAPERLESS_LINK', storageRef: '42' };
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
  });
});
