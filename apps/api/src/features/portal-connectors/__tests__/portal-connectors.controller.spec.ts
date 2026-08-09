import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PortalConnectorsController } from '../portal-connectors.controller';
import { PortalConnectorService } from '../portal-connector.service';
import type { PortalConnectorHealth } from '../portal-connector.interface';

describe('PortalConnectorsController', () => {
  let controller: PortalConnectorsController;
  let service: PortalConnectorService;

  beforeEach(() => {
    service = {
      listCatalog: vi.fn(),
      getCatalogEntry: vi.fn(),
      listPlugins: vi.fn(),
      getPluginHealth: vi.fn(),
    } as unknown as PortalConnectorService;
    controller = new PortalConnectorsController(service);
  });

  it('delegates catalog and plugins to the service', () => {
    (service.listCatalog as ReturnType<typeof vi.fn>).mockReturnValue([{ providerKey: 'huk-coburg' }]);
    (service.getCatalogEntry as ReturnType<typeof vi.fn>).mockReturnValue({ providerKey: 'huk-coburg' });
    (service.listPlugins as ReturnType<typeof vi.fn>).mockReturnValue([]);

    expect(controller.listCatalog()).toEqual([{ providerKey: 'huk-coburg' }]);
    expect(controller.getCatalogEntry('huk-coburg')).toEqual({ providerKey: 'huk-coburg' });
    expect(controller.listPlugins()).toEqual([]);
  });

  it('throws NotFoundException for unknown catalog entries', () => {
    (service.getCatalogEntry as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(() => controller.getCatalogEntry('unbekannt')).toThrow(NotFoundException);
  });

  it('degrades in a controlled way for an unknown plugin instead of 500', async () => {
    (service.getPluginHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: false,
      healthy: false,
      reason: 'Plugin nicht registriert',
      checkedAt: new Date().toISOString(),
    } satisfies PortalConnectorHealth);

    const health = await controller.pluginHealth('unbekannt');
    expect(health.available).toBe(false);
    expect(health.healthy).toBe(false);
  });
});
