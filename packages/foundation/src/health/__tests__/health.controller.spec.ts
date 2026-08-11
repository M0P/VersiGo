import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../health.controller';
import { DatabaseService } from '../../database';
import { RedisHealthService } from '../../redis-health';
import { CapabilityFlagsService } from '../../capabilities';
import { WorkerHeartbeatService } from '../../worker-health';
import { AppConfigService } from '../../config';

function buildCapabilities(): CapabilityFlagsService {
  return {
    snapshot: vi.fn().mockResolvedValue({
      oidc: false,
      local: false,
      ai: false,
      paperless: false,
      storage: false,
      familySharing: true,
    }),
  } as unknown as CapabilityFlagsService;
}

function buildWorkerHeartbeat(worker: 'up' | 'down' | 'unknown' = 'up'): WorkerHeartbeatService {
  return {
    getStatus: vi.fn().mockResolvedValue({ worker, lastSeenAt: null, workerId: null }),
  } as unknown as WorkerHeartbeatService;
}

function buildConfig(appVersion: string | undefined): AppConfigService {
  return { appVersion } as unknown as AppConfigService;
}

function buildController(
  db: DatabaseService,
  redisHealth: RedisHealthService,
  capabilities: CapabilityFlagsService,
  workerHeartbeat: WorkerHeartbeatService,
  appVersion: string | undefined = '1.0.0-beta.2',
): HealthController {
  return new HealthController(db, redisHealth, capabilities, workerHeartbeat, buildConfig(appVersion));
}

describe('HealthController', () => {
  it('returns status ok for /health without sensitive data', () => {
    const db = { isHealthy: vi.fn() } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn() } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat());

    expect(controller.health()).toEqual({ status: 'ok', version: '1.0.0-beta.2' });
  });

  it('reports version on /health and /ready', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat());

    expect(controller.health().version).toBe('1.0.0-beta.2');
    const result = await controller.ready();
    expect(result.version).toBe('1.0.0-beta.2');
  });

  it('reports version unknown when APP_VERSION is not set', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    // Constructed directly: buildController's default parameter would apply
    // when passing `undefined` as the last argument.
    const controller = new HealthController(
      db,
      redisHealth,
      buildCapabilities(),
      buildWorkerHeartbeat(),
      buildConfig(undefined),
    );

    expect(controller.health().version).toBe('unknown');
    const result = await controller.ready();
    expect(result.version).toBe('unknown');
  });

  it('returns status ready when database and redis are reachable', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat());

    const result = await controller.ready();
    expect(result.status).toBe('ready');
    expect(result.database).toBe('up');
    expect(result.redis).toBe('up');
    expect(result.worker).toBe('up');
  });

  it('returns status degraded when the database is not reachable', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(false) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat());

    const result = await controller.ready();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });

  it('returns status degraded when redis is not reachable', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(false) } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat());

    const result = await controller.ready();
    expect(result.status).toBe('degraded');
    expect(result.redis).toBe('down');
  });

  it('returns status degraded instead of 500 when the capability snapshot fails (DB down)', async () => {
    // BugFix-05: snapshot() resolves through the SettingsResolverService, which
    // touches the DB and can reject when the DB is down. /ready must then
    // fail soft with status 'degraded' + empty capabilities instead of 500.
    const db = { isHealthy: vi.fn().mockResolvedValue(false) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const capabilities = {
      snapshot: vi.fn().mockRejectedValue(new Error('database connection refused')),
    } as unknown as CapabilityFlagsService;
    const controller = buildController(db, redisHealth, capabilities, buildWorkerHeartbeat());

    const result = await controller.ready();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
    expect(result.capabilities).toEqual({});
  });

  it('reports the worker state transparently without flipping the overall status', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat('down'));

    const result = await controller.ready();
    // A worker outage is status information, not an API readiness hazard.
    expect(result.worker).toBe('down');
    expect(result.status).toBe('ready');
  });

  it('contains no configuration values in the readiness response', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const redisHealth = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as RedisHealthService;
    const controller = buildController(db, redisHealth, buildCapabilities(), buildWorkerHeartbeat());

    const result = await controller.ready();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/postgresql:\/\//);
    expect(serialized).not.toMatch(/redis:\/\//);
  });
});
