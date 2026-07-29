import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentsService } from '../documents.service';
import { ForbiddenException } from '@nestjs/common';
import type { UploadedFile } from '../documents.types';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
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

type MembershipCheck = {
  userId: string;
  householdId: string;
  role: string;
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

describe('Documents Household-Isolation (Integration)', () => {
  const householdA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const householdB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const policyInA = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  const policyInB = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
  const docInA = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  const userA = { id: '11111111-1111-4111-1111-111111111111' };
  const userB = { id: '22222222-2222-4222-2222-222222222222' };

  let mockDb: ReturnType<typeof createMockDb>;
  let service: DocumentsService;

  function setupMemberships(memberships: MembershipCheck[]) {
    mockDb.householdMembership.findUnique.mockImplementation(
      ({ where }: { where: { householdId_userId: { householdId: string; userId: string } } }) => {
        const found = memberships.find(
          (m) => m.householdId === where.householdId_userId.householdId && m.userId === where.householdId_userId.userId,
        );
        return Promise.resolve(found ?? null);
      },
    );
  }

  beforeEach(() => {
    mockDb = createMockDb();
    service = new DocumentsService(mockDb as never, createMockConfig() as never);
  });

  it('User A laedt Dokument in Household A hoch (erlaubt)', async () => {
    setupMemberships([{ userId: userA.id, householdId: householdA, role: 'OWNER' }]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyInA, householdId: householdA });
    mockDb.policyDocument.findFirst.mockResolvedValue(null);
    mockDb.policyDocument.create.mockResolvedValue({
      id: docInA, policyId: policyInA, fileName: 'test.pdf',
      mimeType: 'application/pdf', fileSize: 12,
      checksum: 'abc', storageType: 'INTERNAL',
      documentVersion: 1, createdByUserId: userA.id,
    });
    mockDb.policyDocument.update.mockResolvedValue({ id: docInA, policyId: policyInA, fileName: 'test.pdf', storageRef: '/tmp/path' });

    const result = await service.upload(householdA, userA.id, policyInA, mockFile, {});

    expect(result!.fileName).toBe('test.pdf');
  });

  it('User A kann kein Dokument in Household B hochladen (Isolation)', async () => {
    setupMemberships([
      { userId: userA.id, householdId: householdA, role: 'OWNER' },
    ]);

    await expect(
      service.upload(householdB, userA.id, policyInB, mockFile, {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine Dokumente in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findAll(householdA, userB.id, policyInA),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann kein einzelnes Dokument in Household A sehen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.findOne(householdA, userB.id, policyInA, docInA),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann keine Metadaten in Household A aktualisieren (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.updateMetadata(householdA, userB.id, policyInA, docInA, { category: 'geheim' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('User B kann kein Dokument in Household A loeschen (Isolation)', async () => {
    setupMemberships([
      { userId: userB.id, householdId: householdB, role: 'OWNER' },
    ]);
    mockDb.insurancePolicy.findFirst.mockResolvedValue({
      id: policyInA, householdId: householdA,
    });

    await expect(
      service.remove(householdA, userB.id, policyInA, docInA),
    ).rejects.toThrow(ForbiddenException);
  });
});
