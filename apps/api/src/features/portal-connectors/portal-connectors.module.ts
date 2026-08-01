import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { PortalConnectorRegistry } from './portal-connector-registry';
import { PortalConnectorService } from './portal-connector.service';
import { PortalConnectorsController } from './portal-connectors.controller';
import { experimentalMailboxSyncPlugin } from './experimental-mailbox.plugin';

/**
 * Portal-Connectoren (AP-18): Katalog, Deeplinks und Plugin-Rahmen.
 *
 * Registriert beim Start das experimentelle, deaktivierte Mailbox-Plugin.
 * `PortalConnectorService` wird exportiert, damit das Policy-Registry-
 * Feature Portal-Links anreichern kann (Deeplink-Aufloesung, Katalog- und
 * Connector-Sicht, `credentialsSet` – nie Zugangsdaten).
 */
@Module({
  controllers: [PortalConnectorsController],
  providers: [PortalConnectorRegistry, PortalConnectorService],
  exports: [PortalConnectorService],
})
export class PortalConnectorsModule implements OnModuleInit {
  private readonly logger = new Logger(PortalConnectorsModule.name);

  constructor(private readonly registry: PortalConnectorRegistry) {}

  onModuleInit(): void {
    this.registry.register(experimentalMailboxSyncPlugin);
    const plugins = this.registry.list();
    this.logger.log(
      `Portal-Connector-Plugins registriert: ${plugins.length} ` +
        `(verfuegbar: ${plugins.filter((p) => p.isAvailable()).length})`,
    );
  }
}
