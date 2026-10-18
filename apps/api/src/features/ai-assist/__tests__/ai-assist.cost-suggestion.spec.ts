import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';

import { AiAssistService } from '../ai-assist.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDb(): any {
  return {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyDocument: { findFirst: vi.fn(), findMany: vi.fn() },
    policyCostEntry: { findMany: vi.fn() },
    aiCoverageSummary: { findFirst: vi.fn() },
  };
}

function validCostJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    amount: 100,
    currency: 'EUR',
    isCredit: false,
    invoiceDate: '2026-10-01',
    validFrom: null,
    validTo: null,
    frequency: 'ANNUAL',
    bookingSource: null,
    description: 'Beitrag',
    confidence: 'high',
    unclearFields: [],
    notes: null,
    ...extra,
  });
}

function createMockRegistry(adapter: unknown) {
  return { getAdapter: vi.fn().mockResolvedValue(adapter) };
}

function createMockSettings(enabled: boolean) {
  return {
    getEffectiveBoolean: vi.fn().mockResolvedValue(enabled),
    getEffectiveString: vi.fn().mockResolvedValue('ollama'),
    getEffectiveNumber: vi.fn().mockResolvedValue(60000),
  };
}

function createMockAuthService() {
  return {
    assertPolicyReadAccess: vi.fn().mockResolvedValue(undefined),
    getReadablePolicyIds: vi.fn().mockResolvedValue(null),
  };
}

describe('AiAssistService.extractCostSuggestion (AP-24 §4.2)', () => {
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';
  const documentId = 'doc-1';
  const user = {
    id: userId,
    username: 'user-1',
    displayName: 'User 1',
    role: GlobalRole.USER,
    status: UserStatus.ACTIVE,
    memberships: [] as { householdId: string }[],
  };

  let mockDb: ReturnType<typeof createMockDb>;
  let extractCostFromDocument: ReturnType<typeof vi.fn>;
  let service: AiAssistService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockDb.householdMembership.findUnique.mockResolvedValue({
      householdId,
      userId,
      role: 'MEMBER',
    });
    mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });

    extractCostFromDocument = vi.fn();
    const adapter = {
      providerKey: 'test',
      extractCostFromDocument,
      healthCheck: vi.fn(),
    };
    service = new AiAssistService(
      mockDb as never,
      createMockRegistry(adapter) as never,
      createMockSettings(true) as never,
      createMockAuthService() as never,
      { add: vi.fn() } as never,
    );
  });

  it('returns a proposal and existing entries for a valid BILLING document', async () => {
    mockDb.policyDocument.findFirst.mockResolvedValue({
      id: documentId,
      fileName: 'rechnung.pdf',
      mimeType: 'application/pdf',
      documentDate: new Date('2026-10-01'),
      aiProcessingExcluded: false,
    });
    extractCostFromDocument.mockResolvedValue({ costJson: validCostJson(), model: 'test-model' });
    mockDb.policyCostEntry.findMany.mockResolvedValue([
      { id: 'entry-1', validFrom: new Date('2026-01-01'), validTo: null, amount: 100, frequency: 'ANNUAL' },
    ]);

    const result = await service.extractCostSuggestion(householdId, user, policyId, documentId);

    expect(result.document.id).toBe(documentId);
    expect(result.suggestion.amount).toBe(100);
    expect(result.existingEntries).toHaveLength(1);
    expect(result.model).toBe('test-model');
    expect(result.providerKey).toBe('test');
  });

  it('retries once with a repair hint on an off-schema answer, then fails cleanly', async () => {
    mockDb.policyDocument.findFirst.mockResolvedValue({
      id: documentId,
      fileName: 'rechnung.pdf',
      mimeType: 'application/pdf',
      documentDate: null,
      aiProcessingExcluded: false,
    });
    extractCostFromDocument
      .mockResolvedValueOnce({ costJson: '{"version":1}', model: 'm' })
      .mockResolvedValueOnce({ costJson: '{"version":1}', model: 'm' });

    await expect(
      service.extractCostSuggestion(householdId, user, policyId, documentId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(extractCostFromDocument).toHaveBeenCalledTimes(2);
    expect(extractCostFromDocument.mock.calls[1][2]).toMatchObject({
      repairHint: expect.any(String),
    });
  });

  it('refuses a document excluded from AI processing', async () => {
    mockDb.policyDocument.findFirst.mockResolvedValue({
      id: documentId,
      fileName: 'rechnung.pdf',
      mimeType: 'application/pdf',
      documentDate: null,
      aiProcessingExcluded: true,
    });

    await expect(
      service.extractCostSuggestion(householdId, user, policyId, documentId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(extractCostFromDocument).not.toHaveBeenCalled();
  });

  it('refuses when the adapter does not implement extractCostFromDocument', async () => {
    mockDb.policyDocument.findFirst.mockResolvedValue({
      id: documentId,
      fileName: 'rechnung.pdf',
      mimeType: 'application/pdf',
      documentDate: null,
      aiProcessingExcluded: false,
    });
    const bareAdapter = { providerKey: 'test', healthCheck: vi.fn() };
    const bareService = new AiAssistService(
      mockDb as never,
      createMockRegistry(bareAdapter) as never,
      createMockSettings(true) as never,
      createMockAuthService() as never,
      { add: vi.fn() } as never,
    );

    await expect(
      bareService.extractCostSuggestion(householdId, user, policyId, documentId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
