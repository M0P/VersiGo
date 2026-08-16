import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { relaxedFetch } from '../relaxed-fetch';

/**
 * BugFix-19: end-to-end tests of relaxedFetch against a real loopback HTTP
 * server. The critical regression is the OIDC token-endpoint POST whose body
 * arrives as a `URLSearchParams` instance – Node's http.request.write() only
 * accepts string/Buffer/Uint8Array, so the body must be normalized.
 */

const servers: http.Server[] = [];

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  servers.push(server);
  return { url: `http://127.0.0.1:${port}` };
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => resolve(body));
  });
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await new Promise<void>((resolve, reject) =>
      server?.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

describe('relaxedFetch', () => {
  it('BugFix-19: sends a URLSearchParams body as x-www-form-urlencoded text with a content-length', async () => {
    const captured: { body: string; contentType?: string; contentLength?: string } = {
      body: '',
    };
    const { url } = await startServer(async (req, res) => {
      captured.contentType = req.headers['content-type'];
      captured.contentLength = req.headers['content-length'];
      captured.body = await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: 'https://versicherung.home/api/auth/callback',
      code: 'auth-code',
      code_verifier: 'verifier',
    });
    const response = await relaxedFetch(`${url}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params,
    });

    expect(response.status).toBe(200);
    expect(captured.body).toBe(params.toString());
    expect(captured.contentType).toContain('x-www-form-urlencoded');
    expect(captured.contentLength).toBe(String(Buffer.byteLength(params.toString())));
    expect(await response.json()).toEqual({ ok: true });
  });

  it('sends a GET without a body (discovery/JWKS/userinfo path)', async () => {
    let method = '';
    let body = '';
    let contentLength: string | undefined;
    const { url } = await startServer(async (req, res) => {
      method = req.method ?? '';
      contentLength = req.headers['content-length'];
      body = await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"issuer":"https://id.home"}');
    });

    const response = await relaxedFetch(`${url}/.well-known/openid-configuration`);

    expect(response.status).toBe(200);
    expect(method).toBe('GET');
    expect(body).toBe('');
    expect(contentLength).toBeUndefined();
    expect(await response.json()).toEqual({ issuer: 'https://id.home' });
  });

  it('sends a plain string body and preserves the caller-provided content-type', async () => {
    let receivedBody = '';
    let receivedContentType: string | undefined;
    const { url } = await startServer(async (req, res) => {
      receivedContentType = req.headers['content-type'];
      receivedBody = await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    const response = await relaxedFetch(`${url}/text`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello world',
    });

    expect(response.status).toBe(200);
    expect(receivedBody).toBe('hello world');
    expect(receivedContentType).toBe('text/plain');
  });

  it('sends a raw ArrayBuffer body as its full byte range', async () => {
    let receivedBody = '';
    const { url } = await startServer(async (req, res) => {
      receivedBody = await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });

    const payload = new ArrayBuffer(7);
    new Uint8Array(payload).set(new TextEncoder().encode('payload'));
    const response = await relaxedFetch(`${url}/json`, {
      method: 'POST',
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(receivedBody).toBe('payload');
  });

  it('honors the byteOffset/byteLength of a Uint8Array view body', async () => {
    let receivedBody = '';
    const { url } = await startServer(async (req, res) => {
      receivedBody = await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });

    // The view covers only the middle of the backing buffer: byteOffset 2,
    // byteLength = expected.length. The indices are derived from the expected
    // payload so the math cannot drift (the payload contains quotes).
    const expected = '{"a":1}';
    const backing = new TextEncoder().encode(`XX${expected}YY`);
    const payload = backing.subarray(2, 2 + expected.length);
    const response = await relaxedFetch(`${url}/json`, {
      method: 'POST',
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(payload.byteOffset).toBe(2);
    expect(payload.byteLength).toBe(expected.length);
    expect(receivedBody).toBe(expected);
  });

  it('does not override a caller-provided content-length header', async () => {
    let receivedLength: string | undefined;
    let receivedBody = '';
    const { url } = await startServer(async (req, res) => {
      receivedLength = req.headers['content-length'];
      receivedBody = await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    const response = await relaxedFetch(`${url}/x`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': '5' },
      body: 'hello',
    });

    expect(response.status).toBe(200);
    expect(receivedLength).toBe('5');
    expect(receivedBody).toBe('hello');
  });

  it('rejects non-http(s) protocols with a 400 response', async () => {
    const response = await relaxedFetch('file:///etc/passwd');
    expect(response.status).toBe(400);
  });

  it('returns 400 for body types openid-client never sends (Blob/FormData/streams)', async () => {
    // No server is started/contacted: the request is rejected before the
    // HTTP layer is reached.
    const response = await relaxedFetch('http://127.0.0.1:1/token', {
      method: 'POST',
      body: new Blob(['x']),
    });
    expect(response.status).toBe(400);
  });

  it('propagates an upstream error response with its status and JSON body', async () => {
    const { url } = await startServer(async (_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"invalid_grant","error_description":"redirect_uri mismatch"}');
    });

    const response = await relaxedFetch(`${url}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ code: 'expired' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'redirect_uri mismatch',
    });
  });
});
