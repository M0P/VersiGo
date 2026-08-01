import { Injectable, Logger } from '@nestjs/common';
import type {
  PortalConnectorCapability,
  PortalConnectorPlugin,
} from './portal-connector.interface';

/**
 * Registry fuer optionale Portal-Connector-Plugins (AP-18).
 *
 * Plugins werden zur Laufzeit des Moduls registriert (experimenteller
 * Mailbox-/Dokumentenabruf). Die Registry haelt keine Fachlogik; sie
 * verwaltet Registrierung, Auflistung und Verfuegbarkeit.
 *
 * Resilienz: `getAvailable()` liefert fuer deaktivierte oder unbekannte
 * Plugins undefined – der Aufrufer degradiert kontrolliert, statt zu
 * brechen. Der Portal-Link bleibt davon unberuehrt.
 */
@Injectable()
export class PortalConnectorRegistry {
  private readonly logger = new Logger(PortalConnectorRegistry.name);
  private readonly plugins = new Map<string, PortalConnectorPlugin>();

  register(plugin: PortalConnectorPlugin): void {
    if (this.plugins.has(plugin.key)) {
      this.logger.warn(`Portal-Connector-Plugin '${plugin.key}' doppelt registriert – ueberschrieben`);
    }
    this.plugins.set(plugin.key, plugin);
    this.logger.log(
      `Portal-Connector-Plugin '${plugin.key}' registriert ` +
        `(experimentell=${plugin.experimental}, verfuegbar=${plugin.isAvailable()})`,
    );
  }

  /** Alle registrierten Plugins (auch deaktivierte/experimentelle). */
  list(): PortalConnectorPlugin[] {
    return [...this.plugins.values()];
  }

  /** Plugin per Schluessel oder undefined. */
  get(key: string): PortalConnectorPlugin | undefined {
    return this.plugins.get(key);
  }

  /**
   * Liefert ein Plugin nur, wenn es registriert UND verfuegbar ist.
   * Unbekannte oder deaktivierte Plugins ergeben undefined (Degradation).
   */
  getAvailable(key: string): PortalConnectorPlugin | undefined {
    const plugin = this.plugins.get(key);
    if (!plugin || !plugin.isAvailable()) return undefined;
    return plugin;
  }

  /**
   * Verfuegbare Capabilities eines Plugins; leere Liste bei unbekanntem
   * oder deaktiviertem Plugin.
   */
  capabilitiesOf(key: string): PortalConnectorCapability[] {
    const plugin = this.getAvailable(key);
    return plugin ? [...plugin.capabilities] : [];
  }
}
