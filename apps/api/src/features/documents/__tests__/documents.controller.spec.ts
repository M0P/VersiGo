import { describe, it, expect, vi } from 'vitest';
import { DocumentsController } from '../documents.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';
import type { UploadedFile } from '../documents.types';
import { NotFoundException } from '@nestjs/common';

vi.mock('fs', () => ({
  default: {
    promises: {
      stat: vi.fn().mockResolvedValue({ size: 12345 }),
    },
    createReadStream: vi.fn(() => {
      const stream = { pipe: vi.fn(), on: vi.fn() };
      return stream;
    }),
  },
  promises: {
    stat: vi.fn().mockResolvedValue({ size: 12345 }),
  },
  createReadStream: vi.fn(() => {
    const stream = { pipe: vi.fn(), on: vi.fn() };
    return stream;
  }),
}));

type ServiceLike = {
  upload: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  updateMetadata: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getFilePath: ReturnType<typeof vi.fn>;
  getDocumentAndPath: ReturnType<typeof vi.fn>;
  sanitizeFilename: ReturnType<typeof vi.fn>;
  linkPaperlessDocument: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    upload: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    updateMetadata: vi.fn(),
    remove: vi.fn(),
    getFilePath: vi.fn(),
    getDocumentAndPath: vi.fn(),
    sanitizeFilename: vi.fn((name: string) => name),
    linkPaperlessDocument: vi.fn(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockRes(): any {
  return {
    set: vi.fn(),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
    headersSent: false,
  };
}

const mockUser: AuthenticatedUser = {
  id: '22222222-2222-4222-2222-222222222222',
  username: 'alice',
  displayName: 'A',
  role: GlobalRole.USER,
  status: UserStatus.ACTIVE,
  memberships: [],
};

const mockFile: UploadedFile = {
  fieldname: 'file',
  originalname: 'test.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('test content'),
  size: 12,
  destination: '',
  filename: '',
  path: '',
};

describe('DocumentsController', () => {
  const householdId = '11111111-1111-4111-1111-111111111111';
  const policyId = '33333333-3333-4333-3333-333333333333';
  const docId = '44444444-4444-4444-4444-444444444444';

  it('upload delegates to the service and returns the result', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    const expected = { id: docId, fileName: 'test.pdf' };
    service.upload.mockResolvedValue(expected);

    const result = await controller.upload(householdId, policyId, mockUser, mockFile, { category: 'vertrag' });

    expect(result).toEqual(expected);
    expect(service.upload).toHaveBeenCalledWith(householdId, mockUser.id, policyId, mockFile, { category: 'vertrag' });
  });

  // BugFix-07 (Q3): POST /paperless links a Paperless document.
  it('linkPaperless delegates to the service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    const expected = { id: 'link-1', storageType: 'PAPERLESS_LINK', storageRef: '42' };
    service.linkPaperlessDocument.mockResolvedValue(expected);

    const result = await controller.linkPaperless(householdId, policyId, mockUser, { paperlessDocumentId: 42 });

    expect(result).toEqual(expected);
    expect(service.linkPaperlessDocument).toHaveBeenCalledWith(householdId, mockUser.id, policyId, 42);
  });

  it('findAll delegates to the service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.findAll.mockResolvedValue([{ id: docId }]);

    const result = await controller.findAll(householdId, policyId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(householdId, mockUser, policyId);
  });

  it('findOne delegates to the service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.findOne.mockResolvedValue({ id: docId });

    const result = await controller.findOne(householdId, policyId, docId, mockUser);

    expect(result).toEqual({ id: docId });
    expect(service.findOne).toHaveBeenCalledWith(householdId, mockUser, policyId, docId);
  });

  it('updateMetadata delegates to the service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.updateMetadata.mockResolvedValue({ id: docId, category: 'neu' });

    const result = await controller.updateMetadata(householdId, policyId, docId, mockUser, { category: 'neu' });

    expect(result.category).toBe('neu');
    expect(service.updateMetadata).toHaveBeenCalledWith(householdId, mockUser.id, policyId, docId, { category: 'neu' });
  });

  it('remove delegates to the service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.remove.mockResolvedValue({ success: true });

    const result = await controller.remove(householdId, policyId, docId, mockUser);

    expect(result.success).toBe(true);
    expect(service.remove).toHaveBeenCalledWith(householdId, mockUser.id, policyId, docId);
  });

  it('download sets Content-Disposition to attachment', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.getDocumentAndPath.mockResolvedValue({
      document: { id: docId, fileName: 'test.pdf', mimeType: 'application/pdf' },
      filePath: '/tmp/test.pdf',
    });
    const res = createMockRes();

    await controller.download(householdId, policyId, docId, mockUser, res);

    expect(service.getDocumentAndPath).toHaveBeenCalledWith(householdId, mockUser, policyId, docId);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': expect.stringContaining('attachment'),
      }),
    );
  });

  it('preview sets Content-Disposition to inline', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.getDocumentAndPath.mockResolvedValue({
      document: { id: docId, fileName: 'test.pdf', mimeType: 'application/pdf' },
      filePath: '/tmp/test.pdf',
    });
    const res = createMockRes();

    await controller.preview(householdId, policyId, docId, mockUser, res);

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': expect.stringContaining('inline'),
      }),
    );
  });

  it('download propagates NotFoundException from the service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.getDocumentAndPath.mockRejectedValue(new NotFoundException('Document not found'));
    const res = createMockRes();

    await expect(
      controller.download(householdId, policyId, docId, mockUser, res),
    ).rejects.toThrow(NotFoundException);
  });

  it('download creates a ReadStream and pipes it to the response', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.getDocumentAndPath.mockResolvedValue({
      document: { id: docId, fileName: 'test.pdf', mimeType: 'application/pdf' },
      filePath: '/tmp/test.pdf',
    });
    const res = createMockRes();

    await controller.download(householdId, policyId, docId, mockUser, res);

    const { createReadStream } = await import('fs');
    expect(createReadStream).toHaveBeenCalledWith('/tmp/test.pdf');
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Disposition': expect.stringContaining('attachment') }),
    );
  });

  it('streamFile returns 500 when stat fails', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    const fsMock = await import('fs');
    (fsMock.promises.stat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));

    service.getDocumentAndPath.mockResolvedValue({
      document: { id: docId, fileName: 'test.pdf', mimeType: 'application/pdf' },
      filePath: '/tmp/test.pdf',
    });
    const res = createMockRes();

    await expect(
      controller.download(householdId, policyId, docId, mockUser, res),
    ).rejects.toThrow('ENOENT');
  });
});
