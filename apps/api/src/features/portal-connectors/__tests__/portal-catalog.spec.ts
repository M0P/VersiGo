import { describe, it, expect } from 'vitest';
import {
  PORTAL_CATALOG,
  PORTAL_CATALOG_VERSION,
  getPortalCatalogEntry,
  listPortalCatalog,
  resolveDeepLinkTemplate,
} from '../portal-catalog';

describe('PortalCatalog', () => {
  it('hat eine Version und mindestens einen Eintrag', () => {
    expect(PORTAL_CATALOG_VERSION).toBe(1);
    expect(PORTAL_CATALOG.length).toBeGreaterThan(0);
  });

  it('hat eindeutige providerKeys', () => {
    const keys = PORTAL_CATALOG.map((e) => e.providerKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('liefert fuer jeden Eintrag Kern-Capability deepLink und Zugangshinweise', () => {
    for (const entry of PORTAL_CATALOG) {
      expect(entry.capabilities).toContain('deepLink');
      expect(entry.accessHint.trim().length).toBeGreaterThan(0);
      expect(entry.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it('hat nur bekannte Deep-Link-Vorlagen (https) oder null', () => {
    for (const entry of PORTAL_CATALOG) {
      if (entry.deepLinkTemplate !== null) {
        expect(entry.deepLinkTemplate.startsWith('https://')).toBe(true);
      }
    }
  });

  it('liefert Eintraege per getPortalCatalogEntry/listPortalCatalog', () => {
    const entry = getPortalCatalogEntry('huk-coburg');
    expect(entry?.displayName).toBe('HUK-COBURG');
    expect(getPortalCatalogEntry('gibt-es-nicht')).toBeUndefined();
    expect(listPortalCatalog()).toHaveLength(PORTAL_CATALOG.length);
  });

  it('loest Deep-Link-Vorlagen deterministisch auf', () => {
    expect(resolveDeepLinkTemplate(null, 'X')).toBeNull();
    expect(resolveDeepLinkTemplate('', 'X')).toBeNull();
    expect(resolveDeepLinkTemplate(' https://a.de/ ', 'X')).toBe('https://a.de/');
    expect(resolveDeepLinkTemplate('https://a.de/{contractNumber}', 'A B/1')).toBe(
      'https://a.de/A%20B%2F1',
    );
    expect(resolveDeepLinkTemplate('https://a.de/{contractNumber}', null)).toBeNull();
  });
});
