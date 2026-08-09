import type { NextConfig } from 'next';

/**
 * Development-specific origin whitelist for the Next.js dev server
 * (HMR/WebSocket and dev requests).
 *
 * By default only local origins are enabled. If the app should be
 * reachable from a local network (e.g. via the LAN IP of the
 * development machine), the list can be extended via
 * NEXT_ALLOWED_DEV_ORIGINS (comma-separated, each "host" or
 * "host:port") – see .env.example.
 *
 * The setting applies exclusively in dev mode; in production
 * the origin check remains restrictive and unchanged.
 */

const DEFAULT_ALLOWED_DEV_ORIGINS = ['localhost:3000', '127.0.0.1:3000'];

function resolveAllowedDevOrigins(): string[] {
  const raw = process.env.NEXT_ALLOWED_DEV_ORIGINS;
  if (!raw) {
    return DEFAULT_ALLOWED_DEV_ORIGINS;
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { allowedDevOrigins: resolveAllowedDevOrigins() }),
};

export default nextConfig;
