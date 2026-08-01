import type {
  PortalConnectorHealth,
  PortalConnectorPlugin,
  PortalConnectorSyncContext,
  PortalConnectorSyncResult,
} from './portal-connector.interface';

/**
 * Experimentelles, deaktiviertes Plugin: Mailbox-/Dokumentenabruf per
 * Browser-Automation (AP-18).
 *
 * Erfuellt das Akzeptanzkriterium "Mailbox-/Dokumentenabruf ist als
 * experimentelles, deaktiviertes Plugin modelliert":
 * - Das Plugin ist in der Registry registriert und als experimentell
 *   sichtbar (API listet es mit `available: false`).
 * - `isAvailable()` liefert immer false: Es gibt in AP-18 bewusst keinen
 *   Freischaltpfad, bis ein echter, sicherer Adapter (z. B. dokumentierte
 *   API statt Browser-Automation, Stufe 2 in docs/06-integrations.md)
 *   existiert und dessen Sicherheits-/Datenschutz-Bewertung abgeschlossen
 *   ist.
 * - Alle Sync-/Abruf-Methoden werfen einen kontrollierten Fehler, falls sie
 *   trotzdem aufgerufen werden. Der Portal-Link (Deeplink + Zugangshinweise)
 *   ist davon nicht betroffen.
 *
 * Browser-Automation (Stufe 3) ist per docs/06-integrations.md bewusst kein
 * Kernsystem und wird hier nur modelliert, nicht betrieben.
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
