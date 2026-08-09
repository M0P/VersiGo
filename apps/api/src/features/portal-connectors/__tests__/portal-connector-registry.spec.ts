import { describe, it, expect } from 'vitest';
import { PortalConnectorRegistry } from '../portal-connector-registry';
import { experimentalMailboxSyncPlugin, MAILBOX_SYNC_PLUGIN_KEY } from '../experimental-mailbox.plugin';

describe('PortalConnectorRegistry', () => {
  it('registers and lists plugins', () => {
    const registry = new PortalConnectorRegistry();
    registry.register(experimentalMailboxSyncPlugin);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get(MAILBOX_SYNC_PLUGIN_KEY)).toBeDefined();
    expect(registry.get('unbekannt')).toBeUndefined();
  });

  it('does not report the disabled experimental plugin as available', () => {
    const registry = new PortalConnectorRegistry();
    registry.register(experimentalMailboxSyncPlugin);

    expect(registry.getAvailable(MAILBOX_SYNC_PLUGIN_KEY)).toBeUndefined();
    expect(registry.capabilitiesOf(MAILBOX_SYNC_PLUGIN_KEY)).toEqual([]);
    expect(registry.capabilitiesOf('unbekannt')).toEqual([]);
  });

  it('experimental plugin is registered, disabled and throws when called', async () => {
    expect(experimentalMailboxSyncPlugin.experimental).toBe(true);
    expect(experimentalMailboxSyncPlugin.isAvailable()).toBe(false);
    expect(experimentalMailboxSyncPlugin.capabilities).toContain('mailboxSync');

    const health = await experimentalMailboxSyncPlugin.healthCheck();
    expect(health.available).toBe(false);
    expect(health.healthy).toBe(false);

    await expect(
      experimentalMailboxSyncPlugin.syncMailbox!({
        linkId: 'l1',
        policyId: 'p1',
        providerKey: 'huk-coburg',
        credentials: {},
      }),
    ).rejects.toThrow(/deaktiviert/);
  });
});
