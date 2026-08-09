import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../config';
import {
  RestartCoordinatorService,
  RESTART_REQUEST_KEY,
  type RestartRequestPayload,
} from '../restart-coordinator.service';

const validKey = 'a'.repeat(64);

function buildConfig(): AppConfigService {
  return new AppConfigService({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/versigo',
    REDIS_URL: 'redis://localhost:6379',
    SETTINGS_ENCRYPTION_KEY: validKey,
    SESSION_SECRET: 'a'.repeat(32),
  });
}

const payload: RestartRequestPayload = {
  requestedAt: '2026-08-05T10:00:00.000Z',
  requestedBy: 'admin',
  reason: 'OIDC aktiviert',
  services: ['api', 'worker'],
};

type MultiLike = {
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
};

type ClientLike = {
  status: string;
  connect: () => Promise<void>;
  set: ReturnType<typeof vi.fn>;
  multi: () => MultiLike;
  disconnect: ReturnType<typeof vi.fn>;
};

function mockMulti(execResult: unknown = [[null, JSON.stringify(payload)]]): MultiLike {
  return {
    get: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(execResult),
  };
}

function mockClient(): ClientLike {
  const multi = mockMulti();
  return {
    status: 'ready',
    connect: () => Promise.resolve(),
    set: vi.fn().mockResolvedValue('OK'),
    multi: () => multi,
    disconnect: vi.fn(),
  };
}

function injectMockClient(service: RestartCoordinatorService, client: ClientLike): void {
  vi.spyOn(service as unknown as { client: ClientLike }, 'client', 'get').mockReturnValue(client);
}

describe('RestartCoordinatorService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('stores a restart request with TTL in Redis', async () => {
    const service = new RestartCoordinatorService(buildConfig());
    const client = mockClient();
    injectMockClient(service, client);

    await service.requestRestart(payload);

    expect(client.set).toHaveBeenCalledWith(
      RESTART_REQUEST_KEY,
      JSON.stringify(payload),
      'EX',
      service.requestTtlSeconds,
    );
  });

  it('fetches the request atomically (get + del) and returns the payload', async () => {
    const service = new RestartCoordinatorService(buildConfig());
    const client = mockClient();
    injectMockClient(service, client);

    const drained = await service.drainRestartRequest();

    expect(drained).toEqual(payload);
    // get und del laufen als Pipeline/MULTI (atomar).
    expect(client.multi().get).toHaveBeenCalledWith(RESTART_REQUEST_KEY);
    expect(client.multi().del).toHaveBeenCalledWith(RESTART_REQUEST_KEY);
  });

  it('returns null when no request is pending', async () => {
    const service = new RestartCoordinatorService(buildConfig());
    const client = mockClient();
    client.multi = () => mockMulti([[null, null]]);
    injectMockClient(service, client);

    const drained = await service.drainRestartRequest();

    expect(drained).toBeNull();
  });

  it('returns null and warns on broken JSON (fail-soft)', async () => {
    const service = new RestartCoordinatorService(buildConfig());
    const client = mockClient();
    client.multi = () => mockMulti([[null, 'kein-json']]);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    injectMockClient(service, client);

    const drained = await service.drainRestartRequest();

    expect(drained).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('the watcher invokes the callback on a request and stops after shutdown', async () => {
    vi.useFakeTimers();
    const service = new RestartCoordinatorService(buildConfig());
    const client = mockClient();
    injectMockClient(service, client);

    const onRequest = vi.fn();
    service.watchRestartRequests(onRequest, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(onRequest).toHaveBeenCalledWith(payload);

    // After shutdown the timer is cleared – no
    // weiteren Abrufe mehr stattfinden.
    await service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy trennt die Redis-Verbindung', async () => {
    const service = new RestartCoordinatorService(buildConfig());
    const client = mockClient();
    injectMockClient(service, client);

    await service.onModuleDestroy();

    expect(client.disconnect).toHaveBeenCalled();
  });
});
