/**
 * Versicherungsportal-Katalog (AP-18).
 *
 * Code-basierter, versionierter Katalog bekannter Versicherungsportale.
 * Der Katalog liefert die Kerninhalte des Arbeitspakets:
 * - Deep-Link-Vorlagen (deepLinkTemplate) fuer "Portal oeffnen" pro Anbieter,
 * - Zugangshinweise (accessHint) als Standardtext je Portal,
 * - Capability-Hinweise (mailboxSync/documentRetrieval nur als experimentell).
 *
 * Bewusste Design-Entscheidung (ADR-008): Der Katalog ist statisch im Code,
 * nicht datenbankgesteuert. Er ist damit immer verfuegbar und benoetigt keine
 * Runtime-Abhaengigkeit; die manuellen Deeplinks (Stufe 1) und Zugangshinweise
 * funktionieren unabhaengig von optionalen Connector-Plugins.
 *
 * Deep-Link-Vorlagen koennen den Platzhalter {contractNumber} enthalten.
 * Die Aufloesung ersetzt ihn durch die Vertragsnummer des Vertrags; ohne
 * Platzhalter wird die Vorlage direkt als Deep-Link verwendet. Ein
 * manuell gesetzter `portalUrl` auf dem Portal-Link hat immer Vorrang.
 */

export type PortalCapability = 'deepLink' | 'mailboxSync' | 'documentRetrieval';

export interface PortalCatalogEntry {
  /** Stabiler Anbieter-Schluessel (z. B. 'huk-coburg'). */
  providerKey: string;
  /** Anzeigename des Versicherungsportals. */
  displayName: string;
  /**
   * Deep-Link-Vorlage (https://...). Kann {contractNumber} enthalten.
   * null, wenn fuer den Anbieter kein stabiler Deeplink bekannt ist
   * (dann greifen ausschliesslich die Zugangshinweise).
   */
  deepLinkTemplate: string | null;
  /** Standard-Zugangshinweise des Portals (Kernumfang). */
  accessHint: string;
  /** Fest unterstuetzte Kern-Capabilities (immer mindestens deepLink). */
  capabilities: PortalCapability[];
  /**
   * Experimentelle Capabilities, die nur ueber ein (standardmaessig
   * deaktiviertes) Connector-Plugin verfuegbar waeren.
   */
  experimentalCapabilities: PortalCapability[];
}

export const PORTAL_CATALOG_VERSION = 1;

/** Vollstaendiger Katalog der bekannten Versicherungsportale. */
export const PORTAL_CATALOG: readonly PortalCatalogEntry[] = [
  {
    providerKey: 'huk-coburg',
    displayName: 'HUK-COBURG',
    deepLinkTemplate: 'https://meine.huk.de/',
    accessHint:
      'Anmeldung mit Benutzername und Passwort. Die Versicherungsnummer steht auf dem Versicherungsschein; bei mehreren Vertraegen wird der gewuenschte Vertrag im Portal gewaehlt.',
    capabilities: ['deepLink'],
    experimentalCapabilities: ['mailboxSync'],
  },
  {
    providerKey: 'huk24',
    displayName: 'HUK24',
    deepLinkTemplate: 'https://www.huk24.de/',
    accessHint:
      'Anmeldung mit Benutzername und Passwort; die Vertraege sind nach Anmeldung unter "Meine Vertraege" erreichbar.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'allianz',
    displayName: 'Allianz',
    deepLinkTemplate: 'https://www.allianz.de/kundenportal/',
    accessHint:
      'Zugang ueber das Allianz Kundenportal mit Benutzername und Passwort; die Vertragsnummer ist dem Versicherungsschein zu entnehmen.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'axa',
    displayName: 'AXA',
    deepLinkTemplate: 'https://www.axa.de/kundenportal',
    accessHint:
      'Anmeldung im AXA Kundenportal; Nutzername und Passwort werden bei der ersten Registrierung selbst gewaehlt.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'ergo',
    displayName: 'ERGO',
    deepLinkTemplate: 'https://mein.ergo.de/',
    accessHint:
      'Zugang ueber "Mein ERGO" mit Benutzername und Passwort; bei Fragen zur Anmeldung hilft der ERGO-Kundenservice.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'generali',
    displayName: 'Generali',
    deepLinkTemplate: 'https://www.generali.de/kundenservice/',
    accessHint:
      'Kundenportal der Generali; Anmeldung mit Benutzername und Passwort, Vertraege sind nach dem Login sichtbar.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'devk',
    displayName: 'DEVK',
    deepLinkTemplate: 'https://www.devk.de/kundencenter',
    accessHint:
      'DEVK Kundencenter; Anmeldung mit Benutzername und Passwort. Die Versicherungsnummer steht auf dem Versicherungsschein.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'signal-iduna',
    displayName: 'Signal Iduna',
    deepLinkTemplate: 'https://www.signal-iduna.de/meine-signal-iduna/',
    accessHint:
      'Anmeldung bei "Meine Signal Iduna"; Vertraege und Unterlagen sind nach dem Login einsehbar.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'vgh',
    displayName: 'VGH',
    deepLinkTemplate: 'https://www.vgh.de/kundenportal',
    accessHint:
      'VGH Kundenportal; Anmeldung mit Benutzername und Passwort, die Vertragsnummer findet sich auf dem Versicherungsschein.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'wuestenrot',
    displayName: 'Wüstenrot',
    deepLinkTemplate: 'https://www.wuestenrot.de/kundenservice',
    accessHint:
      'Kundenservice-Portal der Wüstenrot; Anmeldung mit den hinterlegten Zugangsdaten.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'vkb',
    displayName: 'VKB',
    deepLinkTemplate: 'https://www.vkb.de/kundenportal',
    accessHint:
      'VKB Kundenportal; Anmeldung mit Benutzername und Passwort. Die Vertragsnummer steht auf dem Versicherungsschein.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
  {
    providerKey: 'cosmosdirekt',
    displayName: 'CosmosDirekt',
    deepLinkTemplate: 'https://www.cosmosdirekt.de/',
    accessHint:
      'Anmeldung im Online-Kundenbereich der CosmosDirekt; die Vertragsnummer ist auf dem Versicherungsschein vermerkt.',
    capabilities: ['deepLink'],
    experimentalCapabilities: [],
  },
] as const;

const CATALOG_BY_KEY: ReadonlyMap<string, PortalCatalogEntry> = new Map(
  PORTAL_CATALOG.map((entry) => [entry.providerKey, entry]),
);

/** Liefert den Katalog-Eintrag eines Anbieters oder undefined. */
export function getPortalCatalogEntry(providerKey: string): PortalCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(providerKey);
}

/** Alle Katalog-Eintraege als flache Liste. */
export function listPortalCatalog(): readonly PortalCatalogEntry[] {
  return PORTAL_CATALOG;
}

const CONTRACT_NUMBER_PLACEHOLDER = '{contractNumber}';

/**
 * Loest eine Deep-Link-Vorlage auf:
 * - null/leer => null (kein Deeplink bestimmbar)
 * - ohne Platzhalter => Vorlage direkt
 * - mit {contractNumber}: Vertragsnummer URL-encodiert einsetzen;
 *   fehlt die Vertragsnummer, wird kein kaputter Link erzeugt (null).
 */
export function resolveDeepLinkTemplate(
  template: string | null,
  contractNumber: string | null,
): string | null {
  if (!template) return null;
  const trimmed = template.trim();
  if (!trimmed.includes(CONTRACT_NUMBER_PLACEHOLDER)) return trimmed;
  if (!contractNumber) return null;
  return trimmed.replaceAll(CONTRACT_NUMBER_PLACEHOLDER, encodeURIComponent(contractNumber));
}
