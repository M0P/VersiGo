import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiAssistService } from '../ai-assist.service';
import { NoOpAIAdapter } from '../noop-ai.adapter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockDb(): any {
  return {
    householdMembership: { findUnique: vi.fn() },
    insurancePolicy: { findFirst: vi.fn() },
    policyDocument: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    aiExtractionJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    aiCoverageSummary: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

type MockDb = ReturnType<typeof createMockDb>;

function createMockProviderRegistry() {
  const adapter = new NoOpAIAdapter();
  return {
    getAdapter: vi.fn().mockReturnValue(adapter),
  };
}

function createMockCapabilityFlags(enabled: boolean) {
  return {
    isEnabled: vi.fn().mockReturnValue(enabled),
  };
}

function createMockQueue() {
  return {
    add: vi.fn(),
  };
}

describe('AiAssistService', () => {
  let mockDb: MockDb;
  let service: AiAssistService;
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';

  beforeEach(() => {
    mockDb = createMockDb();
    const mockRegistry = createMockProviderRegistry();
    const mockCapFlags = createMockCapabilityFlags(true);
    const mockQueue = createMockQueue();

    service = new AiAssistService(
      mockDb as never,
      mockRegistry as never,
      mockCapFlags as never,
      mockQueue as never,
    );
  });

  describe('startExtraction', () => {
    it('startet einen Extraktions-Job', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.aiExtractionJob.findFirst.mockResolvedValue(null);
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-1', storageRef: 'ref-1' },
        { id: 'doc-2', storageRef: 'ref-2' },
      ]);
      mockDb.aiExtractionJob.create.mockResolvedValue({
        id: 'job-1',
        policyId,
        status: 'PENDING',
      });

      const result = await service.startExtraction(householdId, userId, policyId);

      expect(result).toEqual({ jobId: 'job-1', status: 'PENDING' });
      expect(mockDb.aiExtractionJob.create).toHaveBeenCalled();
    });

    it('verweigert ohne Household-Mitgliedschaft', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.startExtraction(householdId, userId, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('wirft Fehler bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.startExtraction(householdId, userId, policyId),
      ).rejects.toThrow(NotFoundException);
    });

    it('gibt existierenden Job zurueck bei laufender Extraktion', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.aiExtractionJob.findFirst.mockResolvedValue({ id: 'existing-job', policyId, status: 'PENDING' });

      const result = await service.startExtraction(householdId, userId, policyId);

      expect(result).toEqual({ jobId: 'existing-job', status: 'PENDING' });
      expect(mockDb.aiExtractionJob.create).not.toHaveBeenCalled();
    });

    it('wirft ForbiddenException bei deaktiviertem AI', async () => {
      const mockCapFlags = createMockCapabilityFlags(false);
      const mockRegistry = createMockProviderRegistry();
      const mockQueue = createMockQueue();

      const disabledService = new AiAssistService(
        mockDb as never,
        mockRegistry as never,
        mockCapFlags as never,
        mockQueue as never,
      );

      await expect(
        disabledService.startExtraction(householdId, userId, policyId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getJobStatus', () => {
    it('gibt Job-Status zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiExtractionJob.findFirst.mockResolvedValue({
        id: 'job-1',
        policyId,
        status: 'COMPLETED',
        extractedFieldsJson: { insurerName: 'Test AG' },
      });

      const result = await service.getJobStatus(householdId, userId, policyId, 'job-1');

      expect(result.status).toBe('COMPLETED');
      expect(result.extractedFieldsJson).toEqual({ insurerName: 'Test AG' });
    });

    it('wirft NotFoundException bei unbekanntem Job', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiExtractionJob.findFirst.mockResolvedValue(null);

      await expect(
        service.getJobStatus(householdId, userId, policyId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listJobs', () => {
    it('listet alle Jobs einer Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.aiExtractionJob.findMany.mockResolvedValue([
        { id: 'job-1', policyId, status: 'COMPLETED' },
        { id: 'job-2', policyId, status: 'FAILED' },
      ]);

      const result = await service.listJobs(householdId, userId, policyId);

      expect(result).toHaveLength(2);
      expect(mockDb.aiExtractionJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { policyId } }),
      );
    });
  });

  describe('summarize', () => {
    it('erstellt Zusammenfassung', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findMany.mockResolvedValue([]);
      mockDb.aiCoverageSummary.create.mockResolvedValue({
        id: 'summary-1',
        policyId,
        summaryMarkdown: 'Test summary',
      });

      const result = await service.summarize(householdId, userId, policyId);

      expect(result).toBeNull(); // NoOp adapter returns null
    });
  });

  describe('setDocumentExclusion', () => {
    it('setzt Ausschlussmarkierung fuer Dokument', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.policyDocument.findFirst.mockResolvedValue({ id: 'doc-1', policyId });
      mockDb.policyDocument.update.mockResolvedValue({ id: 'doc-1', aiProcessingExcluded: true });

      const result = await service.setDocumentExclusion(householdId, userId, policyId, 'doc-1', true);

      expect(result.success).toBe(true);
      expect(mockDb.policyDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: { aiProcessingExcluded: true },
        }),
      );
    });

    it('wirft NotFoundException bei unbekanntem Dokument', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.policyDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.setDocumentExclusion(householdId, userId, policyId, 'nonexistent', true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('healthCheck', () => {
    it('meldet nicht verbunden bei deaktiviertem AI', async () => {
      const mockCapFlags = createMockCapabilityFlags(false);
      const mockRegistry = createMockProviderRegistry();
      const mockQueue = createMockQueue();

      const disabledService = new AiAssistService(
        mockDb as never,
        mockRegistry as never,
        mockCapFlags as never,
        mockQueue as never,
      );

      const result = await disabledService.healthCheck();

      expect(result).toEqual({ connected: false, provider: 'none' });
    });

    it('meldet Provider mit NoOp bei verbundenem AI', async () => {
      mockDb.householdMembership.findUnique = vi.fn();

      const result = await service.healthCheck();

      expect(result.provider).toBe('none'); // Mock-Registry gibt NoOpAdapter zurueck
    });
  });
});
