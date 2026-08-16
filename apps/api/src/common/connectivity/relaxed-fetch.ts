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
  const timeoutMs = 10_000;

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Response(null, { status: 400, statusText: 'Unsupported protocol' });
  }

  // BugFix-19: oauth4webapi sends the token-endpoint POST body as a
  // `URLSearchParams` instance. `http.request().write()` only accepts
  // string/Buffer/Uint8Array chunks, so the body must be normalized before
  // it is written (previously this threw ERR_INVALID_ARG_TYPE "Received an
  // instance of URLSearchParams" and the token exchange never reached the
  // IdP). The `content-type` header is already set by oauth4webapi; the
  // `content-length` is added here because Node's http client does not
  // derive it from a written chunk.
  const body = normalizeBody(init?.body);
  if (body.unsupported) {
    return new Response(null, { status: 400, statusText: 'Unsupported body type' });
  }
  if (body.value !== undefined && !headers.has('content-length')) {
    headers.set('content-length', String(Buffer.byteLength(body.value)));
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
    if (body.value !== undefined) request.write(body.value);
    request.end();
    const timer = setTimeout(() => request.destroy(new Error('OIDC request timed out')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
  });
}

type NormalizedBody =
  | { unsupported: true }
  | { unsupported: false; value?: string | Buffer };

/**
 * BugFix-19: converts the `fetch`-style body values used by
 * openid-client/oauth4webapi into something `http.request().write()`
 * accepts (string or Buffer). `URLSearchParams` is the token-endpoint body;
 * discovery/JWKS/userinfo are GET requests without a body. Blob, FormData
 * and ReadableStream are not used by the app's OIDC flows and are rejected.
 */
function normalizeBody(rawBody: unknown): NormalizedBody {
  if (rawBody === undefined || rawBody === null) {
    return { unsupported: false, value: undefined };
  }
  if (rawBody instanceof URLSearchParams) {
    return { unsupported: false, value: rawBody.toString() };
  }
  if (typeof rawBody === 'string') {
    return { unsupported: false, value: rawBody };
  }
  if (rawBody instanceof ArrayBuffer) {
    return { unsupported: false, value: Buffer.from(rawBody) };
  }
  if (ArrayBuffer.isView(rawBody)) {
    // Uint8Array (FetchBody) and any other TypedArray/DataView: copy only
    // the view's own bytes (byteOffset/length of the underlying buffer).
    return {
      unsupported: false,
      value: Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength),
    };
  }
  return { unsupported: true };
}
