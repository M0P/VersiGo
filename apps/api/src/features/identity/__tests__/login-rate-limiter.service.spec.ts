import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginRateLimiterService } from '../login-rate-limiter.service';
import { AppConfigService } from '@versigo/foundation';
import type Redis from 'ioredis';

// Mock Redis
vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    incr: vi.fn(),
    pexpire: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    status: 'ready',
  }));
  return { default: MockRedis };
});

function createMockConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  return {
    get: vi.fn((key: string) => {
      const defaults: Record<string, unknown> = {
        LOCAL_AUTH_MAX_ATTEMPTS: 5,
        LOCAL_AUTH_RATE_LIMIT_WINDOW_MS: 900_000,
        REDIS_URL: 'redis://localhost:6379',
      };
      return overrides[key] ?? defaults[key];
    }),
    get isProduction() { return false; },
    get databaseUrl() { return 'postgresql://localhost:5432/test'; },
    get redisUrl() { return 'redis://localhost:6379'; },
    get encryptionKeyHex() { return '0000000000000000000000000000000000000000000000000000000000000000'; },
  } as unknown as AppConfigService;
}

describe('LoginRateLimiterService', () => {
  let service: LoginRateLimiterService;
  let mockConfig: AppConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = createMockConfig();
    service = new LoginRateLimiterService(mockConfig);
  });

  describe('recordAttempt', () => {
    it('increments the counter for an IP', async () => {
      // Mock Redis incr to return 1
      (service as unknown as { client: Redis }).client = {
        incr: vi.fn().mockResolvedValue(1),
        pexpire: vi.fn().mockResolvedValue('OK'),
        get: vi.fn(),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;

      const count = await service.recordAttempt('192.168.1.1');
      expect(count).toBe(1);
    });

    it('sets the TTL on the first attempt', async () => {
      const client = {
        incr: vi.fn().mockResolvedValue(1),
        pexpire: vi.fn().mockResolvedValue('OK'),
        get: vi.fn(),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      await service.recordAttempt('192.168.1.1');
      expect(client.pexpire).toHaveBeenCalledWith('login:attempts:192.168.1.1', 900_000);
    });

    it('uses the register scope for separate counters', async () => {
      const client = {
        incr: vi.fn().mockResolvedValue(1),
        pexpire: vi.fn().mockResolvedValue('OK'),
        get: vi.fn(),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      await service.recordAttempt('192.168.1.1', 'register');
      expect(client.incr).toHaveBeenCalledWith('register:attempts:192.168.1.1');
      expect(client.pexpire).toHaveBeenCalledWith('register:attempts:192.168.1.1', 900_000);
    });

    it('returns 1 on a Redis error (fail-open)', async () => {
      const client = {
        incr: vi.fn().mockRejectedValue(new Error('Redis down')),
        pexpire: vi.fn(),
        get: vi.fn(),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      const count = await service.recordAttempt('192.168.1.1');
      expect(count).toBe(1);
    });
  });

  describe('isBlocked', () => {
    it('returns true when the limit is exceeded', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn().mockResolvedValue('5'),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      const blocked = await service.isBlocked('192.168.1.1');
      expect(blocked).toBe(true);
    });

    it('returns false when the limit is not exceeded', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn().mockResolvedValue('3'),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      const blocked = await service.isBlocked('192.168.1.1');
      expect(blocked).toBe(false);
    });

    it('returns false when no entry exists', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      const blocked = await service.isBlocked('192.168.1.1');
      expect(blocked).toBe(false);
    });

    it('checks the register scope separately from the login counter', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn().mockResolvedValue('5'),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      const blocked = await service.isBlocked('192.168.1.1', 'register');
      expect(client.get).toHaveBeenCalledWith('register:attempts:192.168.1.1');
      expect(blocked).toBe(true);
    });

    it('returns false on a Redis error (fail-open)', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn().mockRejectedValue(new Error('Redis down')),
        del: vi.fn(),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      const blocked = await service.isBlocked('192.168.1.1');
      expect(blocked).toBe(false);
    });
  });

  describe('resetAttempts', () => {
    it('deletes the entry for an IP', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn(),
        del: vi.fn().mockResolvedValue(1),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      await service.resetAttempts('192.168.1.1');
      expect(client.del).toHaveBeenCalledWith('login:attempts:192.168.1.1');
    });

    it('deletes the register scope entry separately', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn(),
        del: vi.fn().mockResolvedValue(1),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      await service.resetAttempts('192.168.1.1', 'register');
      expect(client.del).toHaveBeenCalledWith('register:attempts:192.168.1.1');
    });
  });

  describe('onModuleDestroy', () => {
    it('closes the Redis connection on shutdown', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn(),
        del: vi.fn(),
        quit: vi.fn().mockResolvedValue('OK'),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(client.quit).toHaveBeenCalled();
    });

    it('does not throw when quit fails', async () => {
      const client = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        get: vi.fn(),
        del: vi.fn(),
        quit: vi.fn().mockRejectedValue(new Error('Redis down')),
        status: 'ready',
      } as unknown as Redis;
      (service as unknown as { client: Redis }).client = client;

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
