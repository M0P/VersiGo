import { Injectable, Logger } from '@nestjs/common';
import type { PortalAccountLink, SyncStatus } from '@prisma/client';
import {
  getPortalCatalogEntry,
  listPortalCatalog,
  PORTAL_CATALOG_VERSION,
  resolveDeepLinkTemplate,
  type PortalCapability,
} from './portal-catalog';
import { PortalConnectorRegistry } from './portal-connector-registry';
import type {
  PortalConnectorHealth,
  PortalConnectorPlugin,
} from './portal-connector.interface';

/** Oeffentliche Sicht auf einen Katalog-Eintrag (ohne interne Details). */
export interface PortalCatalogView {
  providerKey: string;
  displayName: string;
  deepLinkTemplate: string | null;
  accessHint: string;
  capabilities: PortalCapability[];
  experimentalCapabilities: PortalCapability[];
}

/** Oeffentliche Sicht auf ein Connector-Plugin inkl. Verfuegbarkeit. */
export interface PortalConnectorView {
  key: string;
  displayName: string;
  description: string;
  capabilities: PortalCapability[];
  experimental: boolean;
  available: boolean;
}

/**
 * Angereicherte Sicht auf einen Portal-Link.
 * `credentialsEncrypted` wird NIE zurueckgegeben – nur `credentialsSet`.
 */
export interface EnrichedPortalLink {
  id: string;
  policyId: string;
  providerKey: string;
  portalUrl: string | null;
  accessHint: string | null;
  usernameHint: string | null;
  connectorKey: string | null;
  mailboxCapability: boolean;
  lastSyncAt: Date | null;
  syncStatus: SyncStatus;
  createdAt: Date;
  updatedAt: Date;
  credentialsSet: boolean;
  deepLinkUrl: string | null;
  catalog: PortalCatalogView | null;
  connector: PortalConnectorView | null;
}

/**
 * Zentrale Fassade der Portal-Connectoren (AP-18).
 *
 * Stellt Katalog, Plugin-Registry und Deep-Link-Aufloesung bereit und
 * reichert Portal-Links fuer die API-Antworten an. Alle Methoden sind
 * bewusst fehlertolerant: Ein unbekannter oder deaktivierter Connector
 * liefert kontrollierte leere Ergebnisse, ohne den Portal-Link zu
 * beeintraechtigen (Resilienz-Akzeptanzkriterium).
 */
@Injectable()
export class PortalConnectorService {
  private readonly logger = new Logger(PortalConnectorService.name);

  constructor(private readonly registry: PortalConnectorRegistry) {}

  catalogVersion(): number {
    return PORTAL_CATALOG_VERSION;
  }

  /** Katalog-Eintraege als flache, unveraenderbare Sicht. */
  listCatalog(): PortalCatalogView[] {
    return listPortalCatalog().map((entry) => this.toCatalogView(entry));
  }

  /** Einzelner Katalog-Eintrag oder null. */
  getCatalogEntry(providerKey: string): PortalCatalogView | null {
    const entry = getPortalCatalogEntry(providerKey);
    return entry ? this.toCatalogView(entry) : null;
  }

  /** Alle registrierten Plugins inkl. Verfuegbarkeit. */
  listPlugins(): PortalConnectorView[] {
    return this.registry.list().map((plugin) => this.toConnectorView(plugin));
  }

  /**
   * Health-Check eines Plugins. Unbekannte Plugins melden kontrolliert
   * "nicht verfuegbar" (HTTP 200 mit Degradations-Status) statt zu brechen.
   * Auch ein werfender `healthCheck()` eines Plugins wird abgefangen und
   * als kontrollierter Degradations-Status gemeldet (Resilienz-Regel:
   * ein fehlerhaftes Plugin darf nie einen HTTP-500 ausloesen).
   */
  async getPluginHealth(key: string): Promise<PortalConnectorHealth> {
    const plugin = this.registry.get(key);
    if (!plugin) {
      return {
        available: false,
        healthy: false,
        reason: `Connector-Plugin '${key}' ist nicht registriert.`,
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      return await plugin.healthCheck();
    } catch (err) {
      this.logger.warn(
        `health check of plugin '${key}' failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        available: false,
        healthy: false,
        reason: `Health-Check des Connector-Plugins '${key}' ist fehlgeschlagen.`,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Deep-Link-Aufloesung (Kernumfang).
   * Reihenfolge: manuell gesetzter `portalUrl` > Katalog-Deep-Link-Vorlage
   * (mit {contractNumber}-Substitution, falls Platzhalter vorhanden).
   * Liefert null, wenn kein Deeplink bestimmbar ist.
   *
   * Defense-in-depth: Eine manuell gesetzte `portalUrl` wird nur uebernommen,
   * wenn sie ein http(s)-Schema hat. Die DTO-Ebene blockiert andere Schemata
   * bereits bei create/update; diese Pruefung schuetzt zusaetzlich Daten, die
   * ausserhalb des validierten API-Pfads entstanden sind, davor, als
   * `deepLinkUrl` in ein `<a href>` gerendert zu werden (kein `javascript:`/
   * `data:`-Ziel).
   */
  resolveDeepLink(
    link: { portalUrl: string | null; providerKey: string },
    contractNumber: string | null,
  ): string | null {
    const parsed = this.parseHttpUrl(link.portalUrl);
    if (parsed) {
      return parsed.toString();
    }

    const entry = getPortalCatalogEntry(link.providerKey);
    return resolveDeepLinkTemplate(entry?.deepLinkTemplate ?? null, contractNumber);
  }

  /**
   * Defense-in-depth (Single Source of Truth fuer die Link-Ausgabe):
   * Nur http(s)-URLs werden als `portalUrl` an den Client durchgereicht
   * (getrimmt und in einem einheitlichen Format). Die DTO-Ebene blockiert
   * andere Schemata bereits bei create/update; diese Pruefung schuetzt
   * zusaetzlich Daten, die ausserhalb des validierten API-Pfads entstanden
   * sind, davor, als Link-Ziel in ein `<a href>` gerendert zu werden
   * (kein `javascript:`/`data:`-Ziel).
   */
  private parseHttpUrl(value: string | null): URL | null {
    const manual = value?.trim();
    if (!manual) return null;
    try {
      const url = new URL(manual);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  /**
   * Reichert einen Portal-Link fuer API-Antworten an. Entfernt dabei
   * `credentialsEncrypted` (nie ausgeben) und ergaenzt `credentialsSet`,
   * `deepLinkUrl`, Katalog- und Connector-Sicht.
   */
  enrichPortalLink(link: PortalAccountLink, contractNumber: string | null): EnrichedPortalLink {
    const entry = getPortalCatalogEntry(link.providerKey);
    const connector = link.connectorKey
      ? this.registry.get(link.connectorKey)
      : undefined;

    const portalUrl = this.parseHttpUrl(link.portalUrl);

    return {
      id: link.id,
      policyId: link.policyId,
      providerKey: link.providerKey,
      portalUrl: portalUrl ? portalUrl.toString() : null,
      accessHint: link.accessHint ?? entry?.accessHint ?? null,
      usernameHint: link.usernameHint,
      connectorKey: link.connectorKey,
      mailboxCapability: link.mailboxCapability,
      lastSyncAt: link.lastSyncAt,
      syncStatus: link.syncStatus,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      credentialsSet: Boolean(link.credentialsEncrypted),
      deepLinkUrl: this.resolveDeepLink(link, contractNumber),
      catalog: entry ? this.toCatalogView(entry) : null,
      connector: connector ? this.toConnectorView(connector) : null,
    };
  }

  private toCatalogView(entry: {
    providerKey: string;
    displayName: string;
    deepLinkTemplate: string | null;
    accessHint: string;
    capabilities: readonly PortalCapability[];
    experimentalCapabilities: readonly PortalCapability[];
  }): PortalCatalogView {
    return {
      providerKey: entry.providerKey,
      displayName: entry.displayName,
      deepLinkTemplate: entry.deepLinkTemplate,
      accessHint: entry.accessHint,
      capabilities: [...entry.capabilities],
      experimentalCapabilities: [...entry.experimentalCapabilities],
    };
  }

  private toConnectorView(plugin: PortalConnectorPlugin): PortalConnectorView {
    return {
      key: plugin.key,
      displayName: plugin.displayName,
      description: plugin.description,
      capabilities: [...plugin.capabilities],
      experimental: plugin.experimental,
      available: plugin.isAvailable(),
    };
  }
}
