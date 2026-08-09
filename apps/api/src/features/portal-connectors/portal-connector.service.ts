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

/** Public view of a catalog entry (without internal details). */
export interface PortalCatalogView {
  providerKey: string;
  displayName: string;
  deepLinkTemplate: string | null;
  accessHint: string;
  capabilities: PortalCapability[];
  experimentalCapabilities: PortalCapability[];
}

/** Public view of a connector plugin incl. availability. */
export interface PortalConnectorView {
  key: string;
  displayName: string;
  description: string;
  capabilities: PortalCapability[];
  experimental: boolean;
  available: boolean;
}

/**
 * Enriched view of a portal link.
 * `credentialsEncrypted` is NEVER returned - only `credentialsSet`.
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
 * Central facade of the portal connectors (AP-18).
 *
 * Provides catalog, plugin registry and deep-link resolution and
 * enriches portal links for the API responses. All methods are
 * deliberately fault-tolerant: an unknown or disabled connector
 * returns controlled empty results without corrupting the portal link
 * (resilience acceptance criterion).
 */
@Injectable()
export class PortalConnectorService {
  private readonly logger = new Logger(PortalConnectorService.name);

  constructor(private readonly registry: PortalConnectorRegistry) {}

  catalogVersion(): number {
    return PORTAL_CATALOG_VERSION;
  }

  /** Catalog entries as a flat, immutable view. */
  listCatalog(): PortalCatalogView[] {
    return listPortalCatalog().map((entry) => this.toCatalogView(entry));
  }

  /** Single catalog entry or null. */
  getCatalogEntry(providerKey: string): PortalCatalogView | null {
    const entry = getPortalCatalogEntry(providerKey);
    return entry ? this.toCatalogView(entry) : null;
  }

  /** All registered plugins incl. availability. */
  listPlugins(): PortalConnectorView[] {
    return this.registry.list().map((plugin) => this.toConnectorView(plugin));
  }

  /**
   * Health check of a plugin. Unknown plugins report "unavailable" in a
   * controlled way (HTTP 200 with degradation status) instead of breaking.
   * A throwing `healthCheck()` of a plugin is also caught and reported as
   * a controlled degradation status (resilience rule: a faulty plugin
   * must never cause an HTTP-500).
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
   * Deep-link resolution (core scope).
   * Order: manually set `portalUrl` > catalog deep-link template (with
   * {contractNumber} substitution if a placeholder exists).
   * Returns null if no deep link can be determined.
   *
   * Defense-in-depth: a manually set `portalUrl` is only adopted when it
   * has an http(s) scheme. The DTO layer already blocks other schemes at
   * create/update; this check additionally protects data created outside
   * the validated API path from being rendered as `deepLinkUrl` into an
   * `<a href>` (no `javascript:`/`data:` target).
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
   * Defense-in-depth (single source of truth for link output):
   * Only http(s) URLs are passed to the client as `portalUrl` (trimmed
   * and in a uniform format). The DTO layer already blocks other schemes
   * at create/update; this check additionally protects data created
   * outside the validated API path from being rendered as a link target
   * in an `<a href>` (no `javascript:`/`data:` target).
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
   * Enriches a portal link for API responses. Removes
   * `credentialsEncrypted` (never returned) and adds `credentialsSet`,
   * `deepLinkUrl`, catalog and connector views.
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
