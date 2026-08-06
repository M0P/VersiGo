import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEndpoint } from '../connectivity-test';

/**
 * BugFix-06 (Teil 2) – Redirect-Revalidierung: `testEndpoint` folgt
 * Redirects niemals blind, sondern validiert jedes 3xx-Ziel erneut gegen
 * den SSRF-Guard (`assertSafeTestEndpoint`). Ein oeffentlicher Endpunkt
 * darf den Server-Request also nicht auf private/metadata-Adressen
 * umleiten, auch wenn `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` deaktiviert
 * ist. Zudem wird das Integrationstoken nur auf Redirects innerhalb des
 * urspruenglichen Origins weitergegeben (kein Open-Redirect-Leak).
 */
describe('connectivity-test (BugFix-06: redirect re-validation)', () => {
  let server: Server;
  let serverB: Server;
  let baseUrl = '';

  // Recordings, damit die Requests ohne Response-Body-Pruefung beobachtbar
  // sind (testEndpoint liefert nur Status/Message).
  let crossHostTokenSeen: boolean;
  let sameHostTokenSeen: boolean;

  beforeAll(async () => {
    crossHostTokenSeen = false;
    sameHostTokenSeen = false;

    // Server B auf 127.0.0.2 (anderer Origin): prueft, ob das Token
    // cross-origin weitergegeben wurde.
    serverB = createServer((req, res) => {
      crossHostTokenSeen = Boolean(req.headers.authorization);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('no-token');
    });
    await new Promise<void>((resolve) => {
      serverB.listen(0, '127.0.0.2', () => resolve());
    });
    const portB = (serverB.address() as { port: number }).port;

    server = createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/redirect-private') {
        res.writeHead(302, { Location: 'http://127.0.0.1:9/private' });
        res.end();
      } else if (path === '/redirect-metadata') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      } else if (path === '/redirect-loop-a') {
        res.writeHead(302, { Location: '/redirect-loop-b' });
        res.end();
      } else if (path === '/redirect-loop-b') {
        res.writeHead(302, { Location: '/redirect-loop-a' });
        res.end();
      } else if (path === '/redirect-ok') {
        res.writeHead(302, { Location: '/ok' });
        res.end();
      } else if (path === '/redirect-cross-origin') {
        res.writeHead(302, { Location: `http://127.0.0.2:${portB}/token-check` });
        res.end();
      } else if (path === '/redirect-ok-token') {
        res.writeHead(302, { Location: '/ok-token' });
        res.end();
      } else if (path === '/ok-token') {
        sameHostTokenSeen = Boolean(req.headers.authorization);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address && typeof address === 'object') {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterAll(async () => {
    server.closeAllConnections();
    serverB.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => serverB.close(() => resolve())),
    ]);
  });

  it('meldet einen erreichbaren Endpunkt (HTTP 200)', async () => {
    const result = await testEndpoint(`${baseUrl}/ok`, { allowPrivate: true });
    expect(result.success).toBe(true);
    expect(result.message).toBe('HTTP 200: OK');
  });

  it('folgt einem Redirect auf ein privates Ziel im strikten Modus NICHT', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-private`);
    expect(result.success).toBe(false);
    expect(result.message).toContain('gesperrten Bereich');
  });

  it('folgt einem Redirect auf Cloud-Metadata auch im Lockerungsmodus NICHT', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-metadata`, { allowPrivate: true });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Cloud-Metadata');
  });

  it('folgt einem Redirect auf ein erlaubtes Ziel im Lockerungsmodus', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-ok`, { allowPrivate: true });
    expect(result.success).toBe(true);
    expect(result.message).toBe('HTTP 200: OK');
  });

  it('begrenzt die Anzahl der Redirects (Redirect-Loop)', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-loop-a`, { allowPrivate: true });
    expect(result.success).toBe(false);
    expect(result.message).toContain('too many redirects');
  });

  it('gibt das Token NICHT an einen Redirect auf anderen Origin weiter', async () => {
    crossHostTokenSeen = false;
    const result = await testEndpoint(`${baseUrl}/redirect-cross-origin`, {
      allowPrivate: true,
      token: 'super-secret-token',
    });
    expect(result.success).toBe(true);
    expect(crossHostTokenSeen).toBe(false);
  });

  it('gibt das Token bei einem Redirect innerhalb desselben Origins weiter', async () => {
    sameHostTokenSeen = false;
    const result = await testEndpoint(`${baseUrl}/redirect-ok-token`, {
      allowPrivate: true,
      token: 'super-secret-token',
    });
    expect(result.success).toBe(true);
    expect(sameHostTokenSeen).toBe(true);
  });
});
