import { Injectable, Logger } from '@nestjs/common';
import type {
  PortalConnectorCapability,
  PortalConnectorPlugin,
} from './portal-connector.interface';

/**
 * Registry for optional portal connector plugins (AP-18).
 *
 * Plugins are registered at module runtime (experimental
 * mailbox/document retrieval). The registry holds no business logic; it
 * manages registration, listing and availability.
 *
 * Resilience: `getAvailable()` returns for disabled or unknown
 * Plugins undefined - the caller degrades in a controlled way instead
 * of breaking. The portal link stays unaffected.
 */
@Injectable()
export class PortalConnectorRegistry {
  private readonly logger = new Logger(PortalConnectorRegistry.name);
  private readonly plugins = new Map<string, PortalConnectorPlugin>();

  register(plugin: PortalConnectorPlugin): void {
    if (this.plugins.has(plugin.key)) {
      this.logger.warn(`Portal connector plugin '${plugin.key}' registered twice - overwritten`);
    }
    this.plugins.set(plugin.key, plugin);
    this.logger.log(
      `Portal connector plugin '${plugin.key}' registered ` +
        `(experimental=${plugin.experimental}, available=${plugin.isAvailable()})`,
    );
  }

  /** All registered plugins (incl. disabled/experimental ones). */
  list(): PortalConnectorPlugin[] {
    return [...this.plugins.values()];
  }

  /** Plugin by key or undefined. */
  get(key: string): PortalConnectorPlugin | undefined {
    return this.plugins.get(key);
  }

  /**
   * Returns a plugin only when it is registered AND available.
   * Unknown or disabled plugins yield undefined (degradation).
   */
  getAvailable(key: string): PortalConnectorPlugin | undefined {
    const plugin = this.plugins.get(key);
    if (!plugin || !plugin.isAvailable()) return undefined;
    return plugin;
  }

  /**
   * Available capabilities of a plugin; empty list for an unknown or
   * disabled plugin.
   */
  capabilitiesOf(key: string): PortalConnectorCapability[] {
    const plugin = this.getAvailable(key);
    return plugin ? [...plugin.capabilities] : [];
  }
}
