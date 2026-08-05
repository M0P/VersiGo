/**
 * BugFix-05 (Befund 2): Portal-URL-Normalisierung (Client-seitige
 * Defense-in-Depth).
 *
 * Fehlt das Schema, wird `https://` vorangestellt. Nur wenn KEIN Schema
 * vorhanden ist – `http://…` bleibt unveraendert und `javascript:`/`data:`
 * koennen hier nie entstehen (sie besitzen kein `://`). Die eigentliche
 * Sicherheitsvalidierung (nur http/https, Laengenlimit) uebernimmt das
 * Server-DTO (`@IsUrl` + `@MaxLength(2048)` in policy-registry.dto.ts).
 *
 * Bewusst von der Komponente getrennt, damit der Helper unit-testbar ist
 * (apps/web/src/__tests__/portal-url.spec.ts).
 */
export function normalizePortalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const hasSchema = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  return hasSchema ? trimmed : `https://${trimmed}`;
}
