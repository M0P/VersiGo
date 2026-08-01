/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MonitoringService } from '../monitoring.service';

function createMockQueue() {
  return {
    getJobCounts: vi.fn(),
    getFailed: vi.fn(),
    getJob: vi.fn(),
  };
}

function createMockDb() {
  return {
    aiExtractionJob: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    portalAccountLink: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
}

function createService(overrides: Record<string, any> = {}) {
  const queue = overrides.queue ?? createMockQueue();
  const db = overrides.db ?? createMockDb();
  const aiAssist = overrides.aiAssist ?? { healthCheck: vi.fn() };
  const paperless = overrides.paperless ?? { healthCheck: vi.fn() };
  const settings = overrides.settings ?? { getEffectiveBoolean: vi.fn() };
  const capabilities = overrides.capabilities ?? { isEnabled: vi.fn().mockReturnValue(false) };
  const portalConnectors = overrides.portalConnectors ?? {
    listPlugins: vi.fn().mockReturnValue([]),
    getPluginHealth: vi.fn(),
  };

  const service = new MonitoringService(
    db as never,
    queue as never,
    aiAssist as never,
    paperless as never,
    settings as never,
    capabilities as never,
    portalConnectors as never,
  );
  return { service, queue, db, aiAssist, paperless, settings, capabilities, portalConnectors };
}

describe('MonitoringService', () => {
  it('queueOverview liefert nur Zaehler, keine Payloads', async () => {
    const { service, queue } = createService();
    queue.getJobCounts.mockResolvedValue({
      waiting: 3,
      active: 1,
      delayed: 0,
      failed: 2,
      completed: 100,
    });

    const result = await service.queueOverview();

    expect(result).toEqual([
      { queue: 'ai-extraction', waiting: 3, active: 1, delayed: 0, failed: 2, completed: 100 },
    ]);
    expect(result[0]).not.toHaveProperty('data');
  });

  it('listFailedJobs redigiert: nur Metadaten und gekuerzte failedReason, nie job.data', async () => {
    const { service, queue } = createService();
    queue.getFailed.mockResolvedValue([
      {
        id: 42,
        name: 'extract',
        attemptsMade: 3,
        failedReason: `sensitive error with https://user:token@internal.host/x and ${'a'.repeat(1000)}`,
        finishedOn: 1735689600000,
        data: { policyId: 'p1', documentRef: 'doc1' },
      },
    ]);

    const result = await service.listFailedJobs();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: '42',
      name: 'extract',
      attemptsMade: 3,
      failedReason: expect.stringMatching(/^sensitive error/),
      finishedOn: '2025-01-01T00:00:00.000Z',
    });
    expect(result[0].failedReason!.length).toBeLessThanOrEqual(500);
    expect(result[0]).not.toHaveProperty('data');
  });

  it('retryFailedJob reiht einen existierenden Job erneut ein', async () => {
    const { service, queue } = createService();
    const job = { retry: vi.fn().mockResolvedValue(undefined) };
    queue.getJob.mockResolvedValue(job);

    await expect(service.retryFailedJob('42')).resolves.toEqual({ retried: true });
    expect(queue.getJob).toHaveBeenCalledWith('42');
    expect(job.retry).toHaveBeenCalled();
  });

  it('retryFailedJob wirft NotFoundException fuer unbekannte Jobs', async () => {
    const { service, queue } = createService();
    queue.getJob.mockResolvedValue(null);

    await expect(service.retryFailedJob('nope')).rejects.toThrow(NotFoundException);
  });

  it('aiJobs liefert Status-Zaehler und Metadaten ohne errorMessage/extractedFieldsJson', async () => {
    const { service, db } = createService();
    db.aiExtractionJob.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 2 } },
      { status: 'FAILED', _count: { _all: 1 } },
    ]);
    db.aiExtractionJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        policyId: 'p1',
        providerKey: 'ollama',
        model: 'llama3',
        status: 'FAILED',
        retryCount: 2,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: null,
        errorMessage: 'top secret details',
        extractedFieldsJson: { secret: true },
      },
    ]);

    const result = await service.aiJobs();

    expect(result.statusCounts).toEqual({ COMPLETED: 2, FAILED: 1 });
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0]).not.toHaveProperty('errorMessage');
    expect(result.recent[0]).not.toHaveProperty('extractedFieldsJson');
    expect(result.recent[0].id).toBe('job-1');
  });

  it('integrations liefert nur enabled/connected, keine URLs/Tokens', async () => {
    const { service, aiAssist, paperless, settings, capabilities } = createService();
    aiAssist.healthCheck.mockResolvedValue({ connected: true, provider: 'ollama' });
    paperless.healthCheck.mockResolvedValue(true);
    settings.getEffectiveBoolean.mockResolvedValue(true);
    capabilities.isEnabled.mockReturnValue(true);

    const result = await service.integrations();

    expect(result.ai).toEqual({ enabled: true, provider: 'ollama', connected: true });
    expect(result.paperless).toEqual({ enabled: true, connected: true });
    expect(result.storage).toEqual({ enabled: true });
    expect(JSON.stringify(result)).not.toContain('token');
    expect(JSON.stringify(result)).not.toContain('http');
  });

  it('integrations meldet Portal-Connector-Plugins mit Health, ohne Zugangsdaten', async () => {
    const { service, portalConnectors, aiAssist } = createService({
      portalConnectors: {
        listPlugins: vi.fn().mockReturnValue([
          {
            key: 'mailbox-sync-browser-automation',
            displayName: 'Mailbox-/Dokumentenabruf (Browser-Automation)',
            description: 'experimentell',
            capabilities: ['mailboxSync', 'documentRetrieval'],
            experimental: true,
            available: false,
          },
        ]),
        getPluginHealth: vi.fn().mockResolvedValue({
          available: false,
          healthy: false,
          reason: `Experimentelles Plugin ist deaktiviert. ${'x'.repeat(500)}`,
          checkedAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });
    aiAssist.healthCheck.mockResolvedValue({ connected: false, provider: 'none' });

    const result = await service.integrations();

    expect(portalConnectors.listPlugins).toHaveBeenCalledTimes(1);
    expect(portalConnectors.getPluginHealth).toHaveBeenCalledWith(
      'mailbox-sync-browser-automation',
    );
    expect(result.portalConnectors).toHaveLength(1);
    const plugin = result.portalConnectors[0];
    expect(plugin.key).toBe('mailbox-sync-browser-automation');
    expect(plugin.available).toBe(false);
    expect(plugin.healthy).toBe(false);
    expect(plugin.experimental).toBe(true);
    expect(plugin.reason!.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('credential');
  });

  it('integrations meldet keine Portal-Connectors, wenn keine Plugins registriert sind', async () => {
    const { service, portalConnectors, aiAssist } = createService();
    aiAssist.healthCheck.mockResolvedValue({ connected: false, provider: 'none' });

    const result = await service.integrations();

    expect(result.portalConnectors).toEqual([]);
    expect(portalConnectors.getPluginHealth).not.toHaveBeenCalled();
  });

  it('integrations meldet AI als deaktiviert, wenn kein Provider konfiguriert ist', async () => {
    const { service, aiAssist } = createService();
    aiAssist.healthCheck.mockResolvedValue({ connected: false, provider: 'none' });

    const result = await service.integrations();

    expect(result.ai).toEqual({ enabled: false, provider: 'none', connected: false });
  });
});
