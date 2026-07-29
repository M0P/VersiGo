import { describe, it, expect, vi } from 'vitest';
import { DocumentsController } from '../documents.controller';
import { UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';
import type { UploadedFile } from '../documents.types';

type ServiceLike = {
  upload: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  updateMetadata: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getFilePath: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    upload: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    updateMetadata: vi.fn(),
    remove: vi.fn(),
    getFilePath: vi.fn(),
  };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@example.com',
  displayName: 'A',
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
  const householdId = 'household-1';
  const policyId = 'policy-1';
  const docId = 'doc-1';

  it('upload delegiert an Service und gibt Ergebnis zurueck', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    const expected = { id: docId, fileName: 'test.pdf' };
    service.upload.mockResolvedValue(expected);

    const result = await controller.upload(householdId, policyId, mockUser, mockFile, { category: 'vertrag' });

    expect(result).toEqual(expected);
    expect(service.upload).toHaveBeenCalledWith(householdId, mockUser.id, policyId, mockFile, { category: 'vertrag' });
  });

  it('findAll delegiert an Service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.findAll.mockResolvedValue([{ id: docId }]);

    const result = await controller.findAll(householdId, policyId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('findOne delegiert an Service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.findOne.mockResolvedValue({ id: docId });

    const result = await controller.findOne(householdId, policyId, docId, mockUser);

    expect(result).toEqual({ id: docId });
    expect(service.findOne).toHaveBeenCalledWith(householdId, mockUser.id, policyId, docId);
  });

  it('updateMetadata delegiert an Service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.updateMetadata.mockResolvedValue({ id: docId, category: 'neu' });

    const result = await controller.updateMetadata(householdId, policyId, docId, mockUser, { category: 'neu' });

    expect(result.category).toBe('neu');
    expect(service.updateMetadata).toHaveBeenCalledWith(householdId, mockUser.id, policyId, docId, { category: 'neu' });
  });

  it('remove delegiert an Service', async () => {
    const service = createMockService();
    const controller = new DocumentsController(service as never);
    service.remove.mockResolvedValue({ success: true });

    const result = await controller.remove(householdId, policyId, docId, mockUser);

    expect(result.success).toBe(true);
    expect(service.remove).toHaveBeenCalledWith(householdId, mockUser.id, policyId, docId);
  });
});
