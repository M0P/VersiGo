import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../health.controller';
import { DatabaseService } from '../../database';
import { CapabilityFlagsService } from '../../capabilities';

describe('HealthController', () => {
  it('liefert status ok fuer /health ohne sensitive Daten', () => {
    const db = { isHealthy: vi.fn() } as unknown as DatabaseService;
    const capabilities = { snapshot: vi.fn() } as unknown as CapabilityFlagsService;
    const controller = new HealthController(db, capabilities);

    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('liefert status ready, wenn die Datenbank erreichbar ist', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const capabilities = {
      snapshot: vi.fn().mockReturnValue({ oidc: false, ai: false, paperless: false, storage: false }),
    } as unknown as CapabilityFlagsService;
    const controller = new HealthController(db, capabilities);

    const result = await controller.ready();
    expect(result.status).toBe('ready');
    expect(result.database).toBe('up');
  });

  it('liefert status degraded, wenn die Datenbank nicht erreichbar ist', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(false) } as unknown as DatabaseService;
    const capabilities = {
      snapshot: vi.fn().mockReturnValue({ oidc: false, ai: false, paperless: false, storage: false }),
    } as unknown as CapabilityFlagsService;
    const controller = new HealthController(db, capabilities);

    const result = await controller.ready();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('down');
  });

  it('enthaelt keine Konfigurationswerte im Readiness-Response', async () => {
    const db = { isHealthy: vi.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const capabilities = {
      snapshot: vi.fn().mockReturnValue({ oidc: false, ai: false, paperless: false, storage: false }),
    } as unknown as CapabilityFlagsService;
    const controller = new HealthController(db, capabilities);

    const result = await controller.ready();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/postgresql:\/\//);
    expect(serialized).not.toMatch(/redis:\/\//);
  });
});
