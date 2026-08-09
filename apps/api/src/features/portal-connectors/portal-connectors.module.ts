import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { PortalConnectorRegistry } from './portal-connector-registry';
import { PortalConnectorService } from './portal-connector.service';
import { PortalConnectorsController } from './portal-connectors.controller';
import { experimentalMailboxSyncPlugin } from './experimental-mailbox.plugin';

/**
 * Portal connectors (AP-18): catalog, deep links and plugin framework.
 *
 * Registers the experimental, disabled mailbox plugin on startup.
 * `PortalConnectorService` is exported so the policy-registry feature
 * can enrich portal links (deep-link resolution, catalog and connector
 * view, `credentialsSet` - never access credentials).
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
      `Portal connector plugins registered: ${plugins.length} ` +
        `(available: ${plugins.filter((p) => p.isAvailable()).length})`,
    );
  }
}
