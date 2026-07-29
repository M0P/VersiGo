import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentsService } from '../documents.service';
import { ForbiddenException } from '@nestjs/common';
import type { UploadedFile } from '../documents.types';

function createMockDb() {
  const db: Record<string, unknown> & {
    householdMembership: { findUnique: ReturnType<typeof vi.fn> };
    insurancePolicy: { findFirst: ReturnType<typeof vi.fn> };
    policyDocument: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  } = {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyDocument: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  db.$transaction = vi.fn((cb: (tx: typeof db) => unknown) => cb(db));
  return db;
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
  const householdA = 'household-aaaa';
  const householdB = 'household-bbbb';
  const policyInA = 'policy-in-a';
  const policyInB = 'policy-in-b';
  const docInA = 'doc-in-a';
  const userA = { id: 'user-aaaa' };
  const userB = { id: 'user-bbbb' };

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
    service = new DocumentsService(mockDb as never);
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
    mockDb.policyDocument.update.mockResolvedValue({ id: docInA, storageRef: '/tmp/path' });
    mockDb.policyDocument.findUnique.mockResolvedValue({ id: docInA, fileName: 'test.pdf' });

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
