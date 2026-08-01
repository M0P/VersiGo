import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../health.controller';
import { DatabaseService } from '../../database';
import { RedisHealthService } from '../../redis-health';
import { CapabilityFlagsService } from '../../capabilities';
import { WorkerHeartbeatService } from '../../worker-health';

function buildCapabilities(): CapabilityFlagsService {
  return {
    snapshot: vi.fn().mockReturnValue({ oidc: false, ai: false, paperless: false, storage: false }),
  } as unknown as CapabilityFlagsService;
}

function buildWorkerHeartbeat(worker: 'up' | 'down' | 'unknown' = 'up'): WorkerHeartbeatService {
  return {
    getStatus: vi.fn().mockResolvedValue({ worker, lastSeenAt: null, workerId: null }),
  } as unknown as WorkerHeartbeatService;
}

describe('HealthController', () => {
  it('liefert status ok fuer /health ohne sensitive Daten', () => {
    const db = { isHealthy: vi.fn() } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn() } as unknown as RedisHealthService;
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat(),
    );

    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('liefert status ready, wenn Datenbank und Redis erreichbar sind', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat(),
    );

    const result = await controller.ready();
    expect(result.status).toBe('ready');
    expect(result.database).toBe('up');
    expect(result.redis).toBe('up');
    expect(result.worker).toBe('up');
  });

  it('liefert status degraded, wenn die Datenbank nicht erreichbar ist', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(false) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat(),
    );

    const result = await controller.ready();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });

  it('liefert status degraded, wenn Redis nicht erreichbar ist', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(false) } as unknown as RedisHealthService;
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat(),
    );

    const result = await controller.ready();
    expect(result.status).toBe('degraded');
    expect(result.redis).toBe('down');
  });

  it('meldet den Worker-Zustand transparent, ohne das Gesamt-status zu kippen', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat('down'),
    );

    const result = await controller.ready();
    // Worker-Ausfall ist Status-Information, keine Readiness-Gefaehrdung der API
    expect(result.worker).toBe('down');
    expect(result.status).toBe('ready');
  });

  it('enthaelt keine Konfigurationswerte im Readiness-Response', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat(),
    );

    const result = await controller.ready();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/postgresql:\/\//);
    expect(serialized).not.toMatch(/redis:\/\//);
  });
});
