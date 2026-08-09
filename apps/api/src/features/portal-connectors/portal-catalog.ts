/**
 * Insurance portal catalog (AP-18).
 *
 * Code-based, versioned catalog of known insurance portals.
 * The catalog provides the core contents of the work package:
 * - Deep-link templates (deepLinkTemplate) for "open portal" per provider,
 * - Access hints (accessHint) as the standard text per portal,
 * - Capability hints (mailboxSync/documentRetrieval only as experimental).
 *
 * Deliberate design decision (ADR-008): the catalog is static in code,
 * not database-driven. It is therefore always available and needs no
 * runtime dependency; the manual deep links (stage 1) and access hints
 * work independently of optional connector plugins.
 *
 * Deep-link templates may contain the {contractNumber} placeholder.
 * The resolution replaces it with the contract's contract number; without
 * placeholder, the template is used directly as a deep link. A manually
 * set `portalUrl` on the portal link always takes precedence.
 */

export type PortalCapability = 'deepLink' | 'mailboxSync' | 'documentRetrieval';

export interface PortalCatalogEntry {
  /** Stable provider key (e.g. 'huk-coburg'). */
  providerKey: string;
  /** Display name of the insurance portal. */
  displayName: string;
  /**
   * Deep-link template (https://...). May contain {contractNumber}.
   * null when no stable deep link is known for the provider (then only
   * the access hints apply).
   */
  deepLinkTemplate: string | null;
  /** Standard access hints of the portal (core scope). */
  accessHint: string;
  /** Firmly supported core capabilities (always at least deepLink). */
  capabilities: PortalCapability[];
  /**
   * Experimental capabilities that would only be available via a (by
   * default disabled) connector plugin.
   */
  experimentalCapabilities: PortalCapability[];
}

export const PORTAL_CATALOG_VERSION = 1;

/** Complete catalog of the known insurance portals. */
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

/** Returns the catalog entry of a provider or undefined. */
export function getPortalCatalogEntry(providerKey: string): PortalCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(providerKey);
}

/** All catalog entries as a flat list. */
export function listPortalCatalog(): readonly PortalCatalogEntry[] {
  return PORTAL_CATALOG;
}

const CONTRACT_NUMBER_PLACEHOLDER = '{contractNumber}';

/**
 * Resolves a deep-link template:
 * - null/empty => null (no deep link determinable)
 * - without placeholder => template directly
 * - with {contractNumber}: insert the contract number URL-encoded; if the
 *   contract number is missing, no broken link is created (null).
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
