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
 * Oeffentliche Portal-Connector-Endpunkte (AP-18).
 *
 * Der Katalog und die Plugin-Liste sind fuer alle authentifizierten Rollen
 * lesbar (READ_ONLY/USER/ADMIN); die globale Session-/Rollen-Guard erzwingt
 * die Authentifizierung. Es sind reine Lese-Endpunkte ohne Household-Bezug
 * (Katalog und Plugins sind keine fachlichen Vertragsdaten).
 *
 * Degradations-Regel: Ein unbekanntes/deaktiviertes Plugin liefert einen
 * kontrollierten Health-Status (HTTP 200, `available: false`) statt 500.
 */
@Controller('portal-connectors')
@Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
export class PortalConnectorsController {
  constructor(private readonly service: PortalConnectorService) {}

  /** Katalog aller bekannten Versicherungsportale (Deeplinks + Zugangshinweise). */
  @Get('catalog')
  listCatalog(): PortalCatalogView[] {
    return this.service.listCatalog();
  }

  /** Einzelner Katalog-Eintrag. */
  @Get('catalog/:providerKey')
  getCatalogEntry(@Param('providerKey') providerKey: string): PortalCatalogView {
    const entry = this.service.getCatalogEntry(providerKey);
    if (!entry) {
      throw new NotFoundException('Versicherungsportal nicht im Katalog');
    }
    return entry;
  }

  /** Alle registrierten Connector-Plugins inkl. Verfuegbarkeit. */
  @Get('plugins')
  listPlugins(): PortalConnectorView[] {
    return this.service.listPlugins();
  }

  /** Health-Check eines Connector-Plugins (degradiert bei Deaktivierung). */
  @Get('plugins/:key/health')
  async pluginHealth(@Param('key') key: string): Promise<PortalConnectorHealth> {
    return this.service.getPluginHealth(key);
  }
}
