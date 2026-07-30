import { describe, it, expect, vi } from 'vitest';
import { AiAssistController } from '../ai-assist.controller';
import { UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';

type ServiceLike = {
  startExtraction: ReturnType<typeof vi.fn>;
  extractNow: ReturnType<typeof vi.fn>;
  listJobs: ReturnType<typeof vi.fn>;
  getJobStatus: ReturnType<typeof vi.fn>;
  summarize: ReturnType<typeof vi.fn>;
  getLatestSummary: ReturnType<typeof vi.fn>;
  setDocumentExclusion: ReturnType<typeof vi.fn>;
  healthCheck: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return {
    startExtraction: vi.fn(),
    extractNow: vi.fn(),
    listJobs: vi.fn(),
    getJobStatus: vi.fn(),
    summarize: vi.fn(),
    getLatestSummary: vi.fn(),
    setDocumentExclusion: vi.fn(),
    healthCheck: vi.fn(),
  };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@example.com',
  displayName: 'A',
  status: UserStatus.ACTIVE,
  memberships: [],
};

describe('AiAssistController', () => {
  const householdId = 'household-1';
  const policyId = 'policy-1';

  it('startExtraction delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.startExtraction.mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });

    const result = await controller.startExtraction(householdId, mockUser, { policyId });

    expect(result).toEqual({ jobId: 'job-1', status: 'PENDING' });
    expect(service.startExtraction).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('extractNow delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    const expected = { fields: { insurerName: 'Test AG' }, confidence: {}, model: 'test' };
    service.extractNow.mockResolvedValue(expected);

    const result = await controller.extractNow(householdId, mockUser, { policyId });

    expect(result).toEqual(expected);
    expect(service.extractNow).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('listJobs delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.listJobs.mockResolvedValue([{ id: 'job-1', status: 'COMPLETED' }]);

    const result = await controller.listJobs(householdId, policyId, mockUser);

    expect(result).toHaveLength(1);
    expect(service.listJobs).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('getJobStatus delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.getJobStatus.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' });

    const result = await controller.getJobStatus(householdId, policyId, 'job-1', mockUser);

    expect(result.status).toBe('COMPLETED');
    expect(service.getJobStatus).toHaveBeenCalledWith(householdId, mockUser.id, policyId, 'job-1');
  });

  it('summarize delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    const expected = { summaryMarkdown: '# Zusammenfassung', model: 'test' };
    service.summarize.mockResolvedValue(expected);

    const result = await controller.summarize(householdId, policyId, mockUser);

    expect(result).toEqual(expected);
    expect(service.summarize).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('getLatestSummary delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.getLatestSummary.mockResolvedValue({ id: 'summary-1', summaryMarkdown: '# Test' });

    const result = await controller.getLatestSummary(householdId, policyId, mockUser);

    expect(result.summaryMarkdown).toBe('# Test');
    expect(service.getLatestSummary).toHaveBeenCalledWith(householdId, mockUser.id, policyId);
  });

  it('setDocumentExclusion delegiert an Service', async () => {
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

  it('healthCheck delegiert an Service', async () => {
    const service = createMockService();
    const controller = new AiAssistController(service as never);
    service.healthCheck.mockResolvedValue({ connected: false, provider: 'none' });

    const result = await controller.healthCheck(householdId);

    expect(result).toEqual({ connected: false, provider: 'none' });
  });
});
