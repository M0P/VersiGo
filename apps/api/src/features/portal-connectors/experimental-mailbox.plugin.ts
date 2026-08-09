import type {
  PortalConnectorHealth,
  PortalConnectorPlugin,
  PortalConnectorSyncContext,
  PortalConnectorSyncResult,
} from './portal-connector.interface';

/**
 * Experimental, disabled plugin: mailbox/document retrieval via browser
 * automation (AP-18).
 *
 * Satisfies the acceptance criterion "mailbox/document retrieval is
 * modeled as an experimental, disabled plugin":
 * - The plugin is registered in the registry and visible as experimental
 *   (the API lists it with `available: false`).
 * - `isAvailable()` always returns false: in AP-18 there is deliberately
 *   no release path until a real, secure adapter (e.g. a documented API
 *   instead of browser automation, stage 2 in docs/06-integrations.md)
 *   exists and its security/privacy assessment is complete.
 * - All sync/retrieval methods throw a controlled error if they are
 *   called anyway. The portal link (deep link + access hints) is not
 *   affected by this.
 *
 * Browser automation (stage 3) is deliberately not a core system per
 * docs/06-integrations.md and is only modeled here, not operated.
 */

const PLUGIN_KEY = 'mailbox-sync-browser-automation';

function disabledError(): Error {
  return new Error(
    `Plugin '${PLUGIN_KEY}' ist experimentell und deaktiviert – keine Mailbox-/Dokumentenfunktionen.`,
  );
}

async function disabledHealth(): Promise<PortalConnectorHealth> {
  return {
    available: false,
    healthy: false,
    reason: 'Experimentelles Plugin ist deaktiviert (AP-18: kein Freischaltpfad).',
    checkedAt: new Date().toISOString(),
  };
}

async function disabledSync(_context: PortalConnectorSyncContext): Promise<PortalConnectorSyncResult> {
  throw disabledError();
}

export const MAILBOX_SYNC_PLUGIN_KEY = PLUGIN_KEY;

export const experimentalMailboxSyncPlugin: PortalConnectorPlugin = {
  key: PLUGIN_KEY,
  displayName: 'Mailbox-/Dokumentenabruf (Browser-Automation)',
  description:
    'Experimenteller Abruf von Versicherungsportal-Postfaechern und Dokumenten. ' +
    'In AP-18 deaktiviert – reine Modellierung des Plugin-Rahmens.',
  capabilities: ['mailboxSync', 'documentRetrieval'],
  experimental: true,
  isAvailable: () => false,
  healthCheck: disabledHealth,
  syncMailbox: disabledSync,
  fetchDocuments: disabledSync,
};
