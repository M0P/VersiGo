import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentsService, MAX_FILE_SIZE } from '../documents.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { UploadedFile } from '../documents.types';

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

  beforeEach(() => {
    mockDb = createMockDb();
    service = new DocumentsService(mockDb as never, createMockConfig() as never);
  });

  describe('upload', () => {
    it('laedt ein Dokument hoch und protokolliert Audit', async () => {
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

    it('verweigert Upload ohne Household-Mitgliedschaft', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.upload(householdId, userId, policyId, mockFile, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Upload bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.upload(householdId, userId, policyId, mockFile, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('verweigert Upload bei nicht erlaubtem MIME-Type', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      const invalidFile = { ...mockFile, mimetype: 'application/x-sh' };

      await expect(
        service.upload(householdId, userId, policyId, invalidFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert Upload bei existierender Prüfsumme', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: 'existing', policyId, checksum: 'abc' });

      await expect(
        service.upload(householdId, userId, policyId, mockFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert Upload bei zu grosser Datei', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      const oversizedFile = { ...mockFile, size: MAX_FILE_SIZE + 1 };

      await expect(
        service.upload(householdId, userId, policyId, oversizedFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('verweigert Upload bei zu langem Dateinamen', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

      const longNameFile = { ...mockFile, originalname: 'a'.repeat(256) };

      await expect(
        service.upload(householdId, userId, policyId, longNameFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('raeumt bei fehlgeschlagenem storeFile auf', async () => {
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
    it('gibt alle nicht-archivierten Dokumente einer Policy zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'd1', policyId, fileName: 'a.pdf' },
        { id: 'd2', policyId, fileName: 'b.pdf' },
      ]);

      const result = await service.findAll(householdId, userId, policyId);

      expect(result).toHaveLength(2);
      expect(mockDb.policyDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId, archivedAt: null }, take: 200 }),
      );
    });
  });

  describe('findOne', () => {
    it('wirft NotFoundException bei fehlendem Dokument', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, userId, policyId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('gibt ein Dokument zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: docId, policyId, fileName: 'test.pdf' });

      const result = await service.findOne(householdId, userId, policyId, docId);

      expect(result.id).toBe(docId);
    });
  });

  describe('updateMetadata', () => {
    it('aktualisiert Metadaten und protokolliert Audit', async () => {
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

    it('wirft NotFoundException bei archiviertem Dokument', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'ADMIN' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMetadata(householdId, userId, policyId, docId, { category: 'neu' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('archiviert ein Dokument, loescht Datei von Platte und protokolliert Audit', async () => {
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

    it('wirft NotFoundException bei fehlendem Dokument', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'OWNER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(householdId, userId, policyId, docId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Household-Isolation', () => {
    it('verweigert Zugriff ohne Mitgliedschaft bei findAll', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.findAll(householdId, userId, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Zugriff ohne Mitgliedschaft bei findOne', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne(householdId, userId, policyId, docId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Zugriff ohne Mitgliedschaft bei updateMetadata', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMetadata(householdId, userId, policyId, docId, { category: 'neu' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verweigert Zugriff ohne Mitgliedschaft bei remove', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(householdId, userId, policyId, docId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
