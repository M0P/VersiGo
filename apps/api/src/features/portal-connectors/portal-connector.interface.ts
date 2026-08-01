/**
 * Plugin-Rahmen fuer optionale Portal-Connectoren (AP-18).
 *
 * Der Kernumfang (Deeplinks und Zugangshinweise) ist kein Plugin und haengt
 * ausschliesslich am Portal-Katalog. Optionale Connectoren (z. B. Mailbox-
 * oder Dokumentenabruf) werden als Plugins modelliert, die in der
 * PortalConnectorRegistry registriert sind.
 *
 * Resilienz-Regel (Akzeptanzkriterium): Ein nicht verfuegbares Plugin
 * (deaktiviert, unbekannt oder fehlerhaft) beeintraechtigt den Portal-Link
 * nicht. Der Portal-Link mit Deeplink und Zugangshinweisen bleibt immer
 * nutzbar; nur die optionale Plugin-Funktion entfaellt kontrolliert.
 */

export type PortalConnectorCapability = 'deepLink' | 'mailboxSync' | 'documentRetrieval';

/** Zugangsdaten fuer den Portal-Zugriff (werden nur intern entschluesselt). */
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
  /** Entschluesselte Zugangsdaten – ausschliesslich fuer den Plugin-Aufruf. */
  credentials: PortalConnectorCredentials;
}

export interface PortalConnectorSyncResult {
  success: boolean;
  message: string;
  fetchedItems: number;
}

export interface PortalConnectorPlugin {
  /** Eindeutiger Plugin-Schluessel (z. B. 'mailbox-sync-browser-automation'). */
  key: string;
  displayName: string;
  description: string;
  capabilities: PortalConnectorCapability[];
  /** true, wenn das Plugin experimentell ist und nicht als Kernfunktion gilt. */
  experimental: boolean;
  /**
   * false, solange das Plugin deaktiviert ist (feature degradation).
   * Deaktivierte Plugins liefern keine Sync-/Abruf-Funktionen.
   */
  isAvailable(): boolean;
  /** Health-Check; deaktivierte Plugins melden kontrolliert "nicht verfuegbar". */
  healthCheck(): Promise<PortalConnectorHealth>;
  /** Experimenteller Mailbox-Abruf – nur bei verfuegbaren Plugins. */
  syncMailbox?(context: PortalConnectorSyncContext): Promise<PortalConnectorSyncResult>;
  /** Experimenteller Dokumentenabruf – nur bei verfuegbaren Plugins. */
  fetchDocuments?(context: PortalConnectorSyncContext): Promise<PortalConnectorSyncResult>;
}
