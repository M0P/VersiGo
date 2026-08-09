import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config';

/**
 * Technical health check for Redis. Contains no domain queue or job
 * logic, only a ping check for the readiness response.
 */
@Injectable()
export class RedisHealthService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (this.client.status === 'end' || this.client.status === 'wait') {
        await this.client.connect();
      }
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
