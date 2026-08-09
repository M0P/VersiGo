/**
 * BugFix-05 (finding 2): portal URL normalization (client-side
 * defense in depth).
 *
 * When the scheme is missing, `https://` is prepended. Only when NO scheme
 * is present – `http://…` stays unchanged and `javascript:`/`data:` can never
 * arise here (they have no `://`). The actual security validation (http/https
 * only, length limit) is done by the server DTO (`@IsUrl` + `@MaxLength(2048)`
 * in policy-registry.dto.ts).
 *
 * Deliberately separated from the component so the helper is unit-testable
 * (apps/web/src/__tests__/portal-url.spec.ts).
 */
export function normalizePortalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const hasSchema = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  return hasSchema ? trimmed : `https://${trimmed}`;
}
