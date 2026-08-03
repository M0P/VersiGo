/**
 * Runtime configuration accessor for VersiGo Web.
 *
 * The API base URL is injected at container startup via the entrypoint script
 * into /runtime-config.js, which is loaded in the HTML head before any
 * client-side code runs. This allows fully dynamic port configuration via
 * .env without requiring a rebuild of the Next.js application.
 *
 * Usage:
 *   import { getApiBaseUrl } from '@/lib/runtime-config';
 *   const apiBase = getApiBaseUrl();
 */

// Type declaration for the runtime config injected via /runtime-config.js
declare global {
  interface Window {
    __VERSIGO_RUNTIME_CONFIG__?: {
      apiBaseUrl: string;
    };
  }
}

let cachedApiBaseUrl: string | null = null;

export function getApiBaseUrl(): string {
  if (cachedApiBaseUrl !== null) {
    return cachedApiBaseUrl;
  }

  // Check if runtime config is available (client-side only)
  if (typeof window !== 'undefined' && window.__VERSIGO_RUNTIME_CONFIG__) {
    cachedApiBaseUrl = window.__VERSIGO_RUNTIME_CONFIG__.apiBaseUrl;
    return cachedApiBaseUrl;
  }

  // Fallback for SSR or if runtime config not loaded yet
  // This should not happen in normal operation since the script is in <head>
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
}

export function resetApiBaseUrlCache(): void {
  cachedApiBaseUrl = null;
}