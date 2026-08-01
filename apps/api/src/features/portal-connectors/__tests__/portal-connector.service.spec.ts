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
    it('manueller portalUrl hat Vorrang vor dem Katalog', () => {
      const url = service.resolveDeepLink(
        { portalUrl: 'https://mein-portal.example.com/login', providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://mein-portal.example.com/login');
    });

    it('nutzt die Katalog-Vorlage ohne Platzhalter direkt', () => {
      const url = service.resolveDeepLink(
        { portalUrl: null, providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://meine.huk.de/');
    });

    it('ersetzt {contractNumber} in Vorlagen URL-encodiert (pure Funktion)', () => {
      // resolveDeepLinkTemplate wird direkt geprueft, da aktuell kein
      // Katalog-Eintrag einen Platzhalter verwendet (bewusst: Deeplinks
      // sind Login-URLs; Platzhalter-Support ist generisch vorbereitet).
      const template = resolveDeepLinkTemplate(
        'https://example.com/portal/{contractNumber}',
        'HUK 123/45',
      );
      expect(template).toBe('https://example.com/portal/HUK%20123%2F45');
    });

    it('liefert null bei Platzhalter-Vorlage ohne Vertragsnummer', () => {
      const url = resolveDeepLinkTemplate('https://example.com/{contractNumber}', null);
      expect(url).toBeNull();
    });

    it('liefert null ohne Katalog-Eintrag und ohne manuelle URL', () => {
      const url = service.resolveDeepLink(
        { portalUrl: null, providerKey: 'unbekannt' },
        'ABC-1',
      );
      expect(url).toBeNull();
    });

    it('lehnt manuelle portalUrl mit nicht-http(s)-Schema ab (kein javascript:/data:-Ziel)', () => {
      const url = service.resolveDeepLink(
        { portalUrl: 'javascript:alert(1)', providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://meine.huk.de/');
    });

    it('faellt bei unparsbarer manueller portalUrl auf die Katalog-Vorlage zurueck', () => {
      const url = service.resolveDeepLink(
        { portalUrl: 'kein url', providerKey: 'huk-coburg' },
        'HUK-123',
      );
      expect(url).toBe('https://meine.huk.de/');
    });
  });

  describe('enrichPortalLink', () => {
    it('streift credentialsEncrypted ab und setzt credentialsSet', () => {
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

    it('liefert fuer deaktivierten Connector eine Connector-Sicht mit available=false', () => {
      const enriched = service.enrichPortalLink(
        makeLink({ connectorKey: 'mailbox-sync-browser-automation' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;

      expect(enriched.deepLinkUrl).toBe('https://meine.huk.de/');
      expect(enriched.connector).not.toBeNull();
      expect(enriched.connector?.available).toBe(false);
      expect(enriched.connector?.experimental).toBe(true);
    });

    it('liefert fuer unbekannten Connector keine Connector-Sicht', () => {
      const enriched = service.enrichPortalLink(
        makeLink({ connectorKey: 'unbekannt' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;

      expect(enriched.connector).toBeNull();
      expect(enriched.deepLinkUrl).toBe('https://meine.huk.de/');
    });

    it('nutzt den Zugangshinweis des Katalogs, wenn keiner am Link gesetzt ist', () => {
      const enriched = service.enrichPortalLink(makeLink() as never, 'HUK-123') as EnrichedPortalLink;
      expect(enriched.accessHint?.length).toBeGreaterThan(0);
    });

    it('gibt portalUrl nur fuer http(s)-URLs aus (kein javascript:/data:-Link-Ziel)', () => {
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
        makeLink({ portalUrl: 'kein url' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;
      expect(unparsable.portalUrl).toBeNull();
    });

    it('normalisiert und trimmt portalUrl wie deepLinkUrl (einheitliches http(s)-Ziel)', () => {
      const padded = service.enrichPortalLink(
        makeLink({ portalUrl: '  https://mein-portal.example.com/login  ' }) as never,
        'HUK-123',
      ) as EnrichedPortalLink;
      expect(padded.portalUrl).toBe('https://mein-portal.example.com/login');
      expect(padded.deepLinkUrl).toBe('https://mein-portal.example.com/login');
    });
  });

  describe('Katalog und Plugins', () => {
    it('listet den Katalog und findet Eintraege', () => {
      expect(service.catalogVersion()).toBe(1);
      const catalog = service.listCatalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(service.getCatalogEntry('huk-coburg')?.displayName).toBe('HUK-COBURG');
      expect(service.getCatalogEntry('unbekannt')).toBeNull();
    });

    it('listet Plugins mit Verfuegbarkeit (experimentell, deaktiviert)', () => {
      const plugins = service.listPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].experimental).toBe(true);
      expect(plugins[0].available).toBe(false);
    });

    it('Health-Check degradiert kontrolliert fuer deaktivierte und unbekannte Plugins', async () => {
      const disabled = await service.getPluginHealth('mailbox-sync-browser-automation');
      expect(disabled.available).toBe(false);
      expect(disabled.healthy).toBe(false);

      const unknown = await service.getPluginHealth('unbekannt');
      expect(unknown.available).toBe(false);
      expect(unknown.healthy).toBe(false);
      expect(unknown.reason).toContain('nicht registriert');
    });

    it('faengt einen werfenden Health-Check ab und meldet kontrollierten Degradations-Status', async () => {
      const registry = new PortalConnectorRegistry();
      registry.register({
        key: 'throwing-plugin',
        displayName: 'Werfendes Plugin',
        description: 'Test-Plugin, dessen Health-Check wirft.',
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
