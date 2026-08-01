import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '@insura/foundation';

/**
 * Redis-based rate limiter for authentication endpoints (login, register).
 *
 * Tracks failed attempts by IP address to prevent brute-force attacks and
 * registration flooding.
 * Uses Redis INCR + EXPIRE for atomic TTL-based counters.
 *
 * Key format: {scope}:attempts:{ipAddress}
 * Scope "login" (Default) und "register" nutzen getrennte Zaehler, damit
 * sich die Endpunkte nicht gegenseitig ausbremsen.
 * TTL is configurable via LOCAL_AUTH_RATE_LIMIT_WINDOW_MS.
 * Max attempts per window is configurable via LOCAL_AUTH_MAX_ATTEMPTS.
 */
@Injectable()
export class LoginRateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginRateLimiterService.name);
  private readonly client: Redis;
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(config: AppConfigService) {
    this.maxAttempts = config.get('LOCAL_AUTH_MAX_ATTEMPTS');
    this.windowMs = config.get('LOCAL_AUTH_RATE_LIMIT_WINDOW_MS');
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
  }

  private redisKey(scope: 'login' | 'register', ip: string): string {
    // The IP is used as-is in the Redis key. IPv6 addresses with colons
    // are valid Redis key characters and do not cause hierarchy issues.
    // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) and their bare IPv4
    // equivalent will produce separate keys, which is acceptable for
    // best-effort rate limiting. Normalization could be added if needed.
    return `${scope}:attempts:${ip}`;
  }

  /**
   * Record a failed attempt for the given IP and scope.
   * Returns the current attempt count.
   */
  async recordAttempt(ip: string, scope: 'login' | 'register' = 'login'): Promise<number> {
    try {
      const key = this.redisKey(scope, ip);
      const count = await this.client.incr(key);
      if (count === 1) {
        // First attempt, set expiry in milliseconds.
        // If pexpire fails, delete the key to avoid a permanently untracked entry.
        const ttlSet = await this.client.pexpire(key, this.windowMs);
        if (ttlSet !== 1) {
          await this.client.del(key).catch(() => {});
          return 1;
        }
      }
      return count;
    } catch (err) {
      this.logger.warn('Rate limiter Redis error, allowing attempt', (err as Error).message);
      return 1; // Fail open - allow on Redis failure
    }
  }

  /**
   * Check whether the given IP is currently rate-limited for the given scope.
   */
  async isBlocked(ip: string, scope: 'login' | 'register' = 'login'): Promise<boolean> {
    try {
      const key = this.redisKey(scope, ip);
      const count = await this.client.get(key);
      return count !== null && parseInt(count, 10) >= this.maxAttempts;
    } catch (err) {
      this.logger.warn('Rate limiter check Redis error, allowing', (err as Error).message);
      return false; // Fail open on Redis failure
    }
  }

  /**
   * Reset the attempt counter for the given IP and scope
   * (e.g., after successful login).
   */
  async resetAttempts(ip: string, scope: 'login' | 'register' = 'login'): Promise<void> {
    try {
      await this.client.del(this.redisKey(scope, ip));
    } catch (err) {
      this.logger.warn('Rate limiter reset Redis error', (err as Error).message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn('Rate limiter Redis shutdown error', (err as Error).message);
    }
  }
}
