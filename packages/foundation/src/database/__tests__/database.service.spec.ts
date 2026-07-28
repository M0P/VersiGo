import { describe, expect, it, vi } from 'vitest';
import { AppConfigService } from '../../config';
import { DatabaseService } from '../database.service';

const validKey = 'a'.repeat(64);

function buildConfig(): AppConfigService {
  return new AppConfigService({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/insura',
    REDIS_URL: 'redis://localhost:6379',
    SETTINGS_ENCRYPTION_KEY: validKey,
  });
}

describe('DatabaseService', () => {
  it('meldet isHealthy=false, wenn die Verbindung fehlschlaegt', async () => {
    const service = new DatabaseService(buildConfig());
    vi.spyOn(service, '$queryRaw' as never).mockImplementation(() => {
      throw new Error('connection refused');
    });

    const healthy = await service.isHealthy();
    expect(healthy).toBe(false);
  });

  it('meldet isHealthy=true bei erfolgreicher Query', async () => {
    const service = new DatabaseService(buildConfig());
    vi.spyOn(service, '$queryRaw' as never).mockResolvedValue([{ result: 1 }] as never);

    const healthy = await service.isHealthy();
    expect(healthy).toBe(true);
  });
});
