/**
 * BugFix-22: the portal URL field was removed from the master data (it was
 * inconsistent with the "Portal-Verknüpfungen" tab). Its legacy value – the
 * policy column `insurerPortalUrl` – is adopted into the portal-link mask as
 * the default value of the "Portallink" input, so no existing value becomes
 * unreachable.
 */
export type PortalLinkFormValues = {
  providerKey: string;
  portalUrl: string;
  usernameHint: string;
  accessHint: string;
};

export function newPortalLinkForm(
  insurerPortalUrl?: string | null,
): PortalLinkFormValues {
  return {
    providerKey: '',
    portalUrl: insurerPortalUrl?.trim() ?? '',
    usernameHint: '',
    accessHint: '',
  };
}
