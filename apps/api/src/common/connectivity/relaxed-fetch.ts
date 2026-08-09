// Note: namespace import (no default import) — the API tsconfig does not
// enable esModuleInterop (convention, see apps/api/src/main.ts).
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import type { CustomFetchOptions } from 'openid-client';

/**
 * BugFix-06 (part 2): minimal TLS-relaxing `fetch` replacement.
 *
 * Used exclusively for OIDC calls (discovery, token, userinfo) when the
 * admin setting `CONNECTIVITY_ALLOW_SELF_SIGNED` is active
 * (self-signed provider certificates). The request runs via `node:https`
 * with `rejectUnauthorized: false` and returns a native `Response`
 * object so `openid-client` can continue unrestricted. Deliberately NO
 * global effect: all other requests of the application keep the strict
 * TLS validation.
 */
export async function relaxedFetch(
  input: RequestInfo | URL,
  init?: RequestInit | CustomFetchOptions,
): Promise<Response> {
  const raw = typeof input === 'string' ? input : input.toString();
  const url = new URL(raw);
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers);
  const body = init?.body as string | Buffer | undefined;
  const timeoutMs = 10_000;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Response(null, { status: 400, statusText: 'Unsupported protocol' });
  }
  const httpModule = url.protocol === 'https:' ? https : http;

  return new Promise<Response>((resolve, reject) => {
    // https.RequestOptions extends http.RequestOptions and adds
    // `rejectUnauthorized` (for http URLs the extra value is simply
    // ignored at runtime).
    const options: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(headers.entries()),
      // The relaxation of this single request class: certificate validation off.
      rejectUnauthorized: false,
    };

    const request = httpModule.request(options, (response: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const contentType = response.headers['content-type'] ?? 'application/json';
        resolve(
          new Response(new Uint8Array(Buffer.concat(chunks)), {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers: { 'content-type': contentType },
          }),
        );
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
    const timer = setTimeout(() => request.destroy(new Error('OIDC request timed out')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
  });
}
