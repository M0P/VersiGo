import { describe, it, expect } from 'vitest';
import { newPortalLinkForm } from '../lib/portal-link-form';

/**
 * BugFix-22: the master-data portal URL field is gone. Its legacy value is
 * adopted into the portal-link mask as the default value of the "Portallink"
 * input, so existing data stays reachable without a second field.
 */
describe('newPortalLinkForm (BugFix-22: adopt the master-data portal link)', () => {
  it('returns an empty form without a legacy portal URL', () => {
    expect(newPortalLinkForm(null)).toEqual({
      providerKey: '',
      portalUrl: '',
      usernameHint: '',
      accessHint: '',
    });
    expect(newPortalLinkForm(undefined)).toEqual({
      providerKey: '',
      portalUrl: '',
      usernameHint: '',
      accessHint: '',
    });
    expect(newPortalLinkForm('   ')).toEqual({
      providerKey: '',
      portalUrl: '',
      usernameHint: '',
      accessHint: '',
    });
  });

  it('pre-fills the portal URL from the policy (legacy value)', () => {
    expect(newPortalLinkForm('https://portal.example.com/login')).toEqual({
      providerKey: '',
      portalUrl: 'https://portal.example.com/login',
      usernameHint: '',
      accessHint: '',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(newPortalLinkForm('  https://portal.example.com  ').portalUrl).toBe(
      'https://portal.example.com',
    );
  });
});
