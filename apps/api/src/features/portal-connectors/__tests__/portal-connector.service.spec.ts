import { describe, it, expect, beforeEach } from 'vitest';
import { PortalConnectorRegistry } from '../portal-connector-registry';
import { PortalConnectorService, type EnrichedPortalLink } from '../portal-connector.service';
import { experimentalMailboxSyncPlugin } from '../experimental-mailbox.plugin';
import { resolveDeepLinkTemplate } from '../portal-catalog';

function makeLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pl-1',
    policyId: 'policy-1',
    providerKey: 'huk-coburg',
    portalUrl: null,
    accessHint: null,
    usernameHint: null,
    connectorKey: null,
    mailboxCapability: false,
    lastSyncAt: null,
    syncStatus: 'PENDING',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    credentialsEncrypted: null,
    ...overrides,
  };
}

describe('PortalConnectorService', () => {
  let service: PortalConnectorService;

  beforeEach(() => {
    const registry = new PortalConnectorRegistry();
    registry.register(experimentalMailboxSyncPlugin);
    service = new PortalConnectorService(registry);
  });

  describe('resolveDeepLink', () => {
    it('a manual portalUrl takes precedence over the catalog', () => {
      const url = service.resolveDeepLink(
        { portalUrl: 'https://mein-portal.example.com/login', providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://mein-portal.example.com/login');
    });

    it('uses the catalog template without placeholders directly', () => {
      const url = service.resolveDeepLink(
        { portalUrl: null, providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://meine.huk.de/');
    });

    it('replaces {contractNumber} in templates URL-encoded (pure function)', () => {
      // resolveDeepLinkTemplate is tested directly since no catalog entry
      // currently uses a placeholder (deliberately: deep links are login
      // URLs; placeholder support is prepared generically).
      const template = resolveDeepLinkTemplate(
        'https://example.com/portal/{contractNumber}',
        'HUK 123/45',
      );
      expect(template).toBe('https://example.com/portal/HUK%20123%2F45');
    });

    it('returns null for a placeholder template without a contract number', () => {
      const url = resolveDeepLinkTemplate('https://example.com/{contractNumber}', null);
      expect(url).toBeNull();
    });

    it('returns null without a catalog entry and without a manual URL', () => {
      const url = service.resolveDeepLink(
        { portalUrl: null, providerKey: 'unbekannt' },
        'ABC-1',
      );
      expect(url).toBeNull();
    });

    it('rejects a manual portalUrl with a non-http(s) scheme (no javascript:/data: target)', () => {
      const url = service.resolveDeepLink(
        { portalUrl: 'javascript:alert(1)', providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://meine.huk.de/');
    });

    it('falls back to the catalog template for an unparsable manual portalUrl', () => {
      const url = service.resolveDeepLink(
        { portalUrl: 'not a url', providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://meine.huk.de/');
    });
  });

  describe('enrichPortalLink', () => {
    it('strips credentialsEncrypted and sets credentialsSet', () => {
      const enriched = service.enrichPortalLink(
        makeLink({ credentialsEncrypted: 'enc:ciphertext' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;

      expect(enriched.credentialsSet).toBe(true);
      expect(enriched).not.toHaveProperty('credentialsEncrypted');
      expect(enriched.deepLinkUrl).toBe('https://meine.huk.de/');
      expect(enriched.accessHint).toBeTruthy();
      expect(enriched.catalog?.displayName).toBe('HUK-COBURG');
    });

    it('returns a connector view with available=false for a disabled connector', () => {
      const enriched = service.enrichPortalLink(
        makeLink({ connectorKey: 'mailbox-sync-browser-automation' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;

      expect(enriched.deepLinkUrl).toBe('https://meine.huk.de/');
      expect(enriched.connector).not.toBeNull();
      expect(enriched.connector?.available).toBe(false);
      expect(enriched.connector?.experimental).toBe(true);
    });

    it('returns no connector view for an unknown connector', () => {
      const enriched = service.enrichPortalLink(
        makeLink({ connectorKey: 'unbekannt' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;

      expect(enriched.connector).toBeNull();
      expect(enriched.deepLinkUrl).toBe('https://meine.huk.de/');
    });

    it('uses the catalog access hint when none is set on the link', () => {
      const enriched = service.enrichPortalLink(makeLink() as never, 'HUK-123') as EnrichedPortalLink;
      expect(enriched.accessHint?.length).toBeGreaterThan(0);
    });

    it('only exposes portalUrl for http(s) URLs (no javascript:/data: link target)', () => {
      const safe = service.enrichPortalLink(
        makeLink({ portalUrl: 'https://mein-portal.example.com/login' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;
      expect(safe.portalUrl).toBe('https://mein-portal.example.com/login');

      const unsafe = service.enrichPortalLink(
        makeLink({ portalUrl: 'javascript:alert(1)' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;
      expect(unsafe.portalUrl).toBeNull();
      expect(unsafe.deepLinkUrl).toBe('https://meine.huk.de/');

      const unparsable = service.enrichPortalLink(
        makeLink({ portalUrl: 'not a url' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;
      expect(unparsable.portalUrl).toBeNull();
    });

    it('normalizes and trims portalUrl like deepLinkUrl (uniform http(s) target)', () => {
      const padded = service.enrichPortalLink(
        makeLink({ portalUrl: '  https://mein-portal.example.com/login  ' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;
      expect(padded.portalUrl).toBe('https://mein-portal.example.com/login');
      expect(padded.deepLinkUrl).toBe('https://mein-portal.example.com/login');
    });
  });

  describe('catalog and plugins', () => {
    it('lists the catalog and finds entries', () => {
      expect(service.catalogVersion()).toBe(1);
      const catalog = service.listCatalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(service.getCatalogEntry('huk-coburg')?.displayName).toBe('HUK-COBURG');
      expect(service.getCatalogEntry('unbekannt')).toBeNull();
    });

    it('lists plugins with availability (experimental, disabled)', () => {
      const plugins = service.listPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].experimental).toBe(true);
      expect(plugins[0].available).toBe(false);
    });

    it('health check degrades in a controlled way for disabled and unknown plugins', async () => {
      const disabled = await service.getPluginHealth('mailbox-sync-browser-automation');
      expect(disabled.available).toBe(false);
      expect(disabled.healthy).toBe(false);

      const unknown = await service.getPluginHealth('unbekannt');
      expect(unknown.available).toBe(false);
      expect(unknown.healthy).toBe(false);
      expect(unknown.reason).toContain('nicht registriert');
    });

    it('catches a throwing health check and reports a controlled degradation status', async () => {
      const registry = new PortalConnectorRegistry();
      registry.register({
        key: 'throwing-plugin',
        displayName: 'Werfendes Plugin',
        description: 'Test plugin whose health check throws.',
        capabilities: ['deepLink'],
        experimental: true,
        isAvailable: () => false,
        healthCheck: () => Promise.reject(new Error('kaputt')),
      });
      const throwingService = new PortalConnectorService(registry);

      const result = await throwingService.getPluginHealth('throwing-plugin');
      expect(result.available).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.reason).toContain('fehlgeschlagen');
      expect(typeof result.checkedAt).toBe('string');
    });
  });
});
