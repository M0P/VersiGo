import type { NextConfig } from 'next';

/**
 * Entwicklungsspezifische Origin-Whitelist fuer Next.js Dev-Server
 * (HMR/WebSocket und Dev-Anfragen).
 *
 * Standardmaessig sind nur lokale Origins freigeschaltet. Soll die
 * App aus einem lokalen Netzwerk (z. B. ueber die LAN-IP des
 * Entwicklungsrechners) erreicht werden, kann die Liste ueber
 * NEXT_ALLOWED_DEV_ORIGINS (kommagetrennt, jeweils "host" oder
 * "host:port") erweitert werden – siehe .env.example.
 *
 * Die Einstellung greift ausschliesslich im Dev-Modus; in Produktion
 * bleibt die Origin-Pruefung unveraendert restriktiv.
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
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { allowedDevOrigins: resolveAllowedDevOrigins() }),
};

export default nextConfig;
