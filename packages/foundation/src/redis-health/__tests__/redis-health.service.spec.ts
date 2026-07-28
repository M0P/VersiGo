import { describe, expect, it, vi } from 'vitest';
import { AppConfigService } from '../../config';
import { RedisHealthService } from '../redis-health.service';

const validKey = 'a'.repeat(64);

function buildConfig(): AppConfigService {
  return new AppConfigService({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/insura',
    REDIS_URL: 'redis://localhost:6379',
    SETTINGS_ENCRYPTION_KEY: validKey,
  });
}

describe('RedisHealthService', () => {
  it('meldet isHealthy=false, wenn ping fehlschlaegt', async () => {
    const service = new RedisHealthService(buildConfig());
    vi.spyOn(service as unknown as { client: { ping: () => Promise<string> } }, 'client', 'get')
      .mockReturnValue({
        status: 'ready',
        ping: () => Promise.reject(new Error('connection refused')),
        connect: () => Promise.resolve(),
        disconnect: () => undefined,
      } as never);

    const healthy = await service.isHealthy();
    expect(healthy).toBe(false);
  });
});
