import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AiAssistController } from '../ai-assist.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  startExtraction: ReturnType<typeof vi.fn>;
  extractNow: ReturnType<typeof vi.fn>;
  listJobs: ReturnType<typeof vi.fn>;
  getJobStatus: ReturnType<typeof vi.fn>;
  summarize: ReturnType<typeof vi.fn>;
  getLatestSummaryWithSources: ReturnType<typeof vi.fn>;
  setDocumentExclusion: ReturnType<typeof vi.fn>;
  healthCheck: ReturnType<typeof vi.fn>;
  extractCostSuggestion: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    startExtraction: vi.fn(),
    extractNow: vi.fn(),
    listJobs: vi.fn(),
    getJobStatus: vi.fn(),
    summarize: vi.fn(),
    getLatestSummaryWithSources: vi.fn(),
    setDocumentExclusion: vi.fn(),
    healthCheck: vi.fn(),
    extractCostSuggestion: vi.fn(),
  };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'alice',
  displayName: 'A',
  role: GlobalRole.USER,
  status: UserStatus.ACTIVE,
  memberships: [],
};

describe('AiAssistController', () => {
  const householdId = 'household-1';
  const policyId = 'policy-1';

  it('startExtraction delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.startExtraction.mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });

    const result = await controller.startExtraction(householdId, mockUser, { policyId });

    expect(result).toEqual({ jobId: 'job-1', status: 'PENDING' });
    expect(service.startExtraction).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('extractNow delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    const expected = { fields: { insurerName: 'Test AG' }, confidence: {}, model: 'test' };
    service.extractNow.mockResolvedValue(expected);

    const result = await controller.extractNow(householdId, mockUser, { policyId });

    expect(result).toEqual(expected);
    expect(service.extractNow).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('listJobs delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.listJobs.mockResolvedValue([{ id: 'job-1', status: 'COMPLETED' }]);

    const result = await controller.listJobs(householdId, policyId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.listJobs).toHaveBeenCalledWith(householdId, mockUser, policyId);
  });

  it('getJobStatus delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.getJobStatus.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' });

    const result = await controller.getJobStatus(householdId, policyId, 'job-1', mockUser);

    expect(result.status).toBe('COMPLETED');
    expect(service.getJobStatus).toHaveBeenCalledWith(householdId, mockUser, policyId, 'job-1');
  });

  it('summarize delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    const expected = { summaryMarkdown: '# Zusammenfassung', model: 'test' };
    service.summarize.mockResolvedValue(expected);

    const result = await controller.summarize(householdId, policyId, mockUser, {});

    expect(result).toEqual(expected);
    expect(service.summarize).toHaveBeenCalledWith(householdId, mockUser.id, policyId, {
      documentIds: undefined,
      acceptPartial: undefined,
    });
  });

  // AP-24 (§3.1): the picker sends the selected CONTRACT documents.
  it('summarize forwards the document selection and the partial confirmation', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.summarize.mockResolvedValue({ format: 'json' });

    await controller.summarize(householdId, policyId, mockUser, {
      documentIds: ['doc-1', 'doc-2'],
      acceptPartial: true,
    });

    expect(service.summarize).toHaveBeenCalledWith(householdId, mockUser.id, policyId, {
      documentIds: ['doc-1', 'doc-2'],
      acceptPartial: true,
    });
  });

  it('summarize tolerates a missing body (legacy client)', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.summarize.mockResolvedValue({ format: 'json' });

    await controller.summarize(householdId, policyId, mockUser, undefined as never);

    expect(service.summarize).toHaveBeenCalledWith(householdId, mockUser.id, policyId, {
      documentIds: undefined,
      acceptPartial: undefined,
    });
  });

  it('summarize reports a failed summarization as 404', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.summarize.mockResolvedValue(null);

    await expect(
      controller.summarize(householdId, policyId, mockUser, {}),
    ).rejects.toThrow(NotFoundException);
  });

  // AP-24 (§4.2): the cost suggestion endpoint returns a proposal only.
  it('extractCostFromDocument delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.extractCostSuggestion.mockResolvedValue({
      document: { id: 'doc-1', fileName: 'rechnung.pdf' },
      suggestion: { amount: 120 },
      existingEntries: [],
    });

    const result = await controller.extractCostFromDocument(householdId, policyId, 'doc-1', mockUser);

    expect(result.suggestion).toEqual({ amount: 120 });
    expect(service.extractCostSuggestion).toHaveBeenCalledWith(
      householdId, mockUser, policyId, 'doc-1',
    );
  });

  it('getLatestSummary delegates to getLatestSummaryWithSources', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.getLatestSummaryWithSources.mockResolvedValue({
      id: 'summary-1',
      summaryMarkdown: '# Test',
      sourceDocuments: [{ id: 'doc-1', fileName: 'test.pdf' }],
      providerKey: 'ollama',
      model: 'llama3',
    });

    const result = await controller.getLatestSummary(householdId, policyId, mockUser);

    expect(result.summaryMarkdown).toBe('# Test');
    expect(result.sourceDocuments).toHaveLength(1);
    expect(service.getLatestSummaryWithSources).toHaveBeenCalledWith(householdId, mockUser, policyId);
  });

  it('setDocumentExclusion delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.setDocumentExclusion.mockResolvedValue({ success: true });

    const result = await controller.setDocumentExclusion(householdId, policyId, mockUser, {
      documentId: 'doc-1',
      excluded: true,
    });

    expect(result.success).toBe(true);
    expect(service.setDocumentExclusion).toHaveBeenCalledWith(
      householdId, mockUser.id, policyId, 'doc-1', true,
    );
  });

  it('healthCheck delegates to the service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.healthCheck.mockResolvedValue({ connected: false, provider: 'none' });

    const result = await controller.healthCheck(householdId);

    expect(result).toEqual({ connected: false, provider: 'none' });
  });

  it('aiStatus delegates to healthCheck', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.healthCheck.mockResolvedValue({ connected: true, provider: 'ollama' });

    const result = await controller.aiStatus(householdId);

    expect(result).toEqual({ connected: true, provider: 'ollama' });
  });
});
