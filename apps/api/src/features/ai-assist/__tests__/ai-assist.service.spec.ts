import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';
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
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const tx = createMockTx();
      return cb(tx);
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockTx(): any {
  return {
    aiCoverageSummary: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
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

function createMockAuthService() {
  return {
    assertPolicyReadAccess: vi.fn().mockResolvedValue(undefined),
    getReadablePolicyIds: vi.fn().mockResolvedValue(null),
  };
}

describe('AiAssistService', () => {
  let mockDb: MockDb;
  let service: AiAssistService;
  const householdId = 'household-1';
  const userId = 'user-1';
  const policyId = 'policy-1';
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
    const mockRegistry = createMockProviderRegistry();
    const mockCapFlags = createMockCapabilityFlags(true);
    const mockQueue = createMockQueue();
    const mockAuthService = createMockAuthService();

    service = new AiAssistService(
      mockDb as never,
      mockRegistry as never,
      mockCapFlags as never,
      mockAuthService as never,
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
        createMockAuthService() as never,
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

      const result = await service.getJobStatus(householdId, user, policyId, 'job-1');

      expect(result.status).toBe('COMPLETED');
      expect(result.extractedFieldsJson).toEqual({ insurerName: 'Test AG' });
    });

    it('wirft NotFoundException bei unbekanntem Job', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiExtractionJob.findFirst.mockResolvedValue(null);

      await expect(
        service.getJobStatus(householdId, user, policyId, 'nonexistent'),
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

      const result = await service.listJobs(householdId, user, policyId);

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

    it('wirft ForbiddenException bei deaktiviertem AI', async () => {
      const mockCapFlags = createMockCapabilityFlags(false);
      const mockRegistry = createMockProviderRegistry();
      const mockQueue = createMockQueue();

      const disabledService = new AiAssistService(
        mockDb as never,
        mockRegistry as never,
        mockCapFlags as never,
        createMockAuthService() as never,
        mockQueue as never,
      );

      await expect(
        disabledService.summarize(householdId, userId, policyId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('wirft NotFoundException bei fehlender Policy', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.summarize(householdId, userId, policyId),
      ).rejects.toThrow(NotFoundException);
    });

    it('erstellt Zusammenfassung erfolgreich und bereinigt alte Eintraege via Transaktion', async () => {
      // Verwende einen gemockten Adapter, der Daten zurueckgibt
      const mockAdapter = {
        providerKey: 'test-provider',
        summarizeCoverage: vi.fn().mockResolvedValue({
          summaryMarkdown: '# Test Zusammenfassung',
          sourceDocumentRefs: ['doc-1', 'doc-2'],
          model: 'test-model',
        }),
        extractContractFacts: vi.fn(),
        healthCheck: vi.fn(),
      };
      const mockRegistry = { getAdapter: vi.fn().mockReturnValue(mockAdapter) };
      const mockCapFlags = createMockCapabilityFlags(true);
      const mockQueue = createMockQueue();

      const svc = new AiAssistService(
        mockDb as never,
        mockRegistry as never,
        mockCapFlags as never,
        createMockAuthService() as never,
        mockQueue as never,
      );

      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'MEMBER' });
      mockDb.insurancePolicy.findFirst.mockResolvedValue({ id: policyId, householdId });
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-1', fileName: 'test.pdf', mimeType: 'application/pdf' },
      ]);

      // Simuliere 6 alte Zusammenfassungen (eine wird geloescht)
      const oldSummaries = Array.from({ length: 6 }, (_, i) => ({ id: `old-${i + 1}` }));
      const txMock = createMockTx();
      txMock.aiCoverageSummary.findMany.mockResolvedValue(oldSummaries.slice(5)); // nach skip 5 bleibt 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => cb(txMock));

      const result = await svc.summarize(householdId, userId, policyId);

      expect(result).not.toBeNull();
      expect(result?.summaryMarkdown).toBe('# Test Zusammenfassung');
      expect(txMock.aiCoverageSummary.create).toHaveBeenCalled();
      // Pruefe, dass alte Eintraege bereinigt wurden
      expect(txMock.aiCoverageSummary.deleteMany).toHaveBeenCalled();
    });
  });

  describe('getLatestSummaryWithSources', () => {
    it('gibt Zusammenfassung mit aufgeloesten Quelldokumenten zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiCoverageSummary.findFirst.mockResolvedValue({
        id: 'summary-1',
        policyId,
        providerKey: 'ollama',
        model: 'llama3',
        summaryMarkdown: '# Test Zusammenfassung',
        sourceDocumentRefsJson: ['doc-1', 'doc-2'],
        createdAt: new Date('2025-01-01'),
      });
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-1', fileName: 'Versicherungsschein.pdf' },
        { id: 'doc-2', fileName: 'Allgemeine Bedingungen.pdf' },
      ]);

      const result = await service.getLatestSummaryWithSources(householdId, user, policyId);

      expect(result.sourceDocuments).toHaveLength(2);
      expect(result.sourceDocuments[0].fileName).toBe('Versicherungsschein.pdf');
      expect(result.sourceDocuments[1].id).toBe('doc-2');
      expect(result.providerKey).toBe('ollama');
    });

    it('gibt leere sourceDocuments bei fehlenden Referenzen zurueck', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiCoverageSummary.findFirst.mockResolvedValue({
        id: 'summary-1',
        policyId,
        providerKey: 'openai-compat',
        model: 'gpt-4',
        summaryMarkdown: '# Test',
        sourceDocumentRefsJson: null,
        createdAt: new Date('2025-01-01'),
      });

      const result = await service.getLatestSummaryWithSources(householdId, user, policyId);

      expect(result.sourceDocuments).toEqual([]);
      expect(result.providerKey).toBe('openai-compat');
    });

    it('wirft NotFoundException bei fehlender Zusammenfassung', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiCoverageSummary.findFirst.mockResolvedValue(null);

      await expect(
        service.getLatestSummaryWithSources(householdId, user, policyId),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolved nur vorhandene Dokumente aus sourceDocumentRefs', async () => {
      mockDb.householdMembership.findUnique.mockResolvedValue({ householdId, userId, role: 'VIEWER' });
      mockDb.aiCoverageSummary.findFirst.mockResolvedValue({
        id: 'summary-1',
        policyId,
        providerKey: 'ollama',
        model: 'llama3',
        summaryMarkdown: '# Test',
        sourceDocumentRefsJson: ['doc-exists', 'doc-deleted'],
        createdAt: new Date('2025-01-01'),
      });
      mockDb.policyDocument.findMany.mockResolvedValue([
        { id: 'doc-exists', fileName: 'Vorhanden.pdf' },
      ]);

      const result = await service.getLatestSummaryWithSources(householdId, user, policyId);

      expect(result.sourceDocuments).toHaveLength(1);
      expect(result.sourceDocuments[0].id).toBe('doc-exists');
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
        createMockAuthService() as never,
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
