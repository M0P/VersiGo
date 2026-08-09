import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { PortalConnectorService } from './portal-connector.service';
import { Roles } from '../identity/roles.decorator';
import type {
  PortalCatalogView,
  PortalConnectorView,
} from './portal-connector.service';
import type { PortalConnectorHealth } from './portal-connector.interface';

/**
 * Public portal connector endpoints (AP-18).
 *
 * The catalog and the plugin list are readable by all authenticated roles
 * (READ_ONLY/USER/ADMIN); the global session/role guard enforces
 * authentication. These are pure read endpoints without household
 * context (catalog and plugins are not business contract data).
 *
 * Degradation rule: an unknown/disabled plugin returns a controlled
 * health status (HTTP 200, `available: false`) instead of a 500.
 */
@Controller('portal-connectors')
@Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
export class PortalConnectorsController {
  constructor(private readonly service: PortalConnectorService) {}

  /** Catalog of all known insurance portals (deep links + access hints). */
  @Get('catalog')
  listCatalog(): PortalCatalogView[] {
    return this.service.listCatalog();
  }

  /** Single catalog entry. */
  @Get('catalog/:providerKey')
  getCatalogEntry(@Param('providerKey') providerKey: string): PortalCatalogView {
    const entry = this.service.getCatalogEntry(providerKey);
    if (!entry) {
      throw new NotFoundException('Insurance portal not in the catalog');
    }
    return entry;
  }

  /** All registered connector plugins incl. availability. */
  @Get('plugins')
  listPlugins(): PortalConnectorView[] {
    return this.service.listPlugins();
  }

  /** Health check of a connector plugin (degrades when disabled). */
  @Get('plugins/:key/health')
  async pluginHealth(@Param('key') key: string): Promise<PortalConnectorHealth> {
    return this.service.getPluginHealth(key);
  }
}
