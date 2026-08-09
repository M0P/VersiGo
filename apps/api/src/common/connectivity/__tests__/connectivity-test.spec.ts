import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEndpoint } from '../connectivity-test';

/**
 * BugFix-06 (part 2) – redirect revalidation: `testEndpoint` never follows
 * redirects blindly but revalidates every 3xx target against the SSRF guard
 * (`assertSafeTestEndpoint`). A public endpoint therefore cannot redirect
 * the server request to private/metadata addresses, even when
 * `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` is disabled. In addition, the
 * integration token is only passed on to redirects within the original
 * origin (no open-redirect leak).
 */
describe('connectivity-test (BugFix-06: redirect re-validation)', () => {
  let server: Server;
  let serverB: Server;
  let baseUrl = '';

  // Recordings so the requests are observable without a response-body
  // check (testEndpoint only returns status/message).
  let crossHostTokenSeen: boolean;
  let sameHostTokenSeen: boolean;

  beforeAll(async () => {
    crossHostTokenSeen = false;
    sameHostTokenSeen = false;

    // Server B on 127.0.0.2 (different origin): checks whether the token
    // was passed cross-origin.
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

  it('reports a reachable endpoint (HTTP 200)', async () => {
    const result = await testEndpoint(`${baseUrl}/ok`, { allowPrivate: true });
    expect(result.success).toBe(true);
    expect(result.message).toBe('HTTP 200: OK');
  });

  it('does NOT follow a redirect to a private target in strict mode', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-private`);
    expect(result.success).toBe(false);
    expect(result.message).toContain('is in a blocked range');
  });

  it('does NOT follow a redirect to cloud metadata even in relaxation mode', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-metadata`, { allowPrivate: true });
    expect(result.success).toBe(false);
    expect(result.message).toContain('blocked cloud metadata address');
  });

  it('follows a redirect to an allowed target in relaxation mode', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-ok`, { allowPrivate: true });
    expect(result.success).toBe(true);
    expect(result.message).toBe('HTTP 200: OK');
  });

  it('limits the number of redirects (redirect loop)', async () => {
    const result = await testEndpoint(`${baseUrl}/redirect-loop-a`, { allowPrivate: true });
    expect(result.success).toBe(false);
    expect(result.message).toContain('too many redirects');
  });

  it('does NOT pass the token to a redirect on another origin', async () => {
    crossHostTokenSeen = false;
    const result = await testEndpoint(`${baseUrl}/redirect-cross-origin`, {
      allowPrivate: true,
      token: 'super-secret-token',
    });
    expect(result.success).toBe(true);
    expect(crossHostTokenSeen).toBe(false);
  });

  it('passes the token on a redirect within the same origin', async () => {
    sameHostTokenSeen = false;
    const result = await testEndpoint(`${baseUrl}/redirect-ok-token`, {
      allowPrivate: true,
      token: 'super-secret-token',
    });
    expect(result.success).toBe(true);
    expect(sameHostTokenSeen).toBe(true);
  });
});
