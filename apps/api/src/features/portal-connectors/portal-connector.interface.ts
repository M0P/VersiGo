/**
 * Plugin framework for optional portal connectors (AP-18).
 *
 * The core scope (deep links and access hints) is not a plugin and
 * depends exclusively on the portal catalog. Optional connectors (e.g.
 * mailbox or document retrieval) are modeled as plugins registered in
 * the PortalConnectorRegistry.
 *
 * Resilience rule (acceptance criterion): an unavailable plugin
 * (disabled, unknown or faulty) does not affect the portal link. The
 * portal link with deep link and access hints always stays usable; only
 * the optional plugin function is omitted in a controlled way.
 */

export type PortalConnectorCapability = 'deepLink' | 'mailboxSync' | 'documentRetrieval';

/** Credentials for portal access (only decrypted internally). */
export interface PortalConnectorCredentials {
  portalUsername?: string;
  portalPassword?: string;
}

export interface PortalConnectorHealth {
  available: boolean;
  healthy: boolean;
  reason: string;
  checkedAt: string;
}

export interface PortalConnectorSyncContext {
  linkId: string;
  policyId: string;
  providerKey: string;
  /** Decrypted credentials – exclusively for the plugin call. */
  credentials: PortalConnectorCredentials;
}

export interface PortalConnectorSyncResult {
  success: boolean;
  message: string;
  fetchedItems: number;
}

export interface PortalConnectorPlugin {
  /** Unique plugin key (e.g. 'mailbox-sync-browser-automation'). */
  key: string;
  displayName: string;
  description: string;
  capabilities: PortalConnectorCapability[];
  /** true when the plugin is experimental and not considered core. */
  experimental: boolean;
  /**
   * false while the plugin is disabled (feature degradation).
   * Disabled plugins provide no sync/retrieval functions.
   */
  isAvailable(): boolean;
  /** Health check; disabled plugins report "unavailable" in a controlled way. */
  healthCheck(): Promise<PortalConnectorHealth>;
  /** Experimental mailbox retrieval - only for available plugins. */
  syncMailbox?(context: PortalConnectorSyncContext): Promise<PortalConnectorSyncResult>;
  /** Experimental document retrieval - only for available plugins. */
  fetchDocuments?(context: PortalConnectorSyncContext): Promise<PortalConnectorSyncResult>;
}
