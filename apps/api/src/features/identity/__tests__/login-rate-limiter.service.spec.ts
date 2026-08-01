import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginRateLimiterService } from '../login-rate-limiter.service';
import { AppConfigService } from '@insura/foundation';
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
    it('erhoeht den Zaehler fuer eine IP', async () => {
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

    it('setzt TTL beim ersten Versuch', async () => {
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

    it('nutzt den register-Scope fuer getrennte Zaehler', async () => {
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

    it('gibt 1 bei Redis-Fehler zurueck (Fail-Open)', async () => {
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
    it('gibt true zurueck wenn Grenze ueberschritten', async () => {
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

    it('gibt false zurueck wenn Grenze nicht ueberschritten', async () => {
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

    it('gibt false zurueck wenn kein Eintrag existiert', async () => {
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

    it('prueft den register-Scope getrennt vom Login-Zaehler', async () => {
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

    it('gibt false bei Redis-Fehler zurueck (Fail-Open)', async () => {
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
    it('loescht den Eintrag fuer eine IP', async () => {
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

    it('loescht den register-Scope-Eintrag getrennt', async () => {
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
    it('schliesst die Redis-Verbindung beim Herunterfahren', async () => {
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

    it('wirft keinen Fehler bei fehlschlagendem quit', async () => {
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
