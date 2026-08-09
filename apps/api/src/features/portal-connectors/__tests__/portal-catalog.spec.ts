import { describe, it, expect } from 'vitest';
import {
  PORTAL_CATALOG,
  PORTAL_CATALOG_VERSION,
  getPortalCatalogEntry,
  listPortalCatalog,
  resolveDeepLinkTemplate,
} from '../portal-catalog';

describe('PortalCatalog', () => {
  it('has a version and at least one entry', () => {
    expect(PORTAL_CATALOG_VERSION).toBe(1);
    expect(PORTAL_CATALOG.length).toBeGreaterThan(0);
  });

  it('has unique providerKeys', () => {
    const keys = PORTAL_CATALOG.map((e) => e.providerKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('provides the core capability deepLink and access hints for every entry', () => {
    for (const entry of PORTAL_CATALOG) {
      expect(entry.capabilities).toContain('deepLink');
      expect(entry.accessHint.trim().length).toBeGreaterThan(0);
      expect(entry.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  it('only has known deep-link templates (https) or null', () => {
    for (const entry of PORTAL_CATALOG) {
      if (entry.deepLinkTemplate !== null) {
        expect(entry.deepLinkTemplate.startsWith('https://')).toBe(true);
      }
    }
  });

  it('returns entries via getPortalCatalogEntry/listPortalCatalog', () => {
    const entry = getPortalCatalogEntry('huk-coburg');
    expect(entry?.displayName).toBe('HUK-COBURG');
    expect(getPortalCatalogEntry('does-not-exist')).toBeUndefined();
    expect(listPortalCatalog()).toHaveLength(PORTAL_CATALOG.length);
  });

  it('resolves deep-link templates deterministically', () => {
    expect(resolveDeepLinkTemplate(null, 'X')).toBeNull();
    expect(resolveDeepLinkTemplate('', 'X')).toBeNull();
    expect(resolveDeepLinkTemplate(' https://a.de/ ', 'X')).toBe('https://a.de/');
    expect(resolveDeepLinkTemplate('https://a.de/{contractNumber}', 'A B/1')).toBe(
      'https://a.de/A%20B%2F1',
    );
    expect(resolveDeepLinkTemplate('https://a.de/{contractNumber}', null)).toBeNull();
  });
});
