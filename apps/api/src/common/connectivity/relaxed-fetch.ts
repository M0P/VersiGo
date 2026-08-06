// Hinweis: Namespace-Import (kein Default-Import) – die API-tsconfig
// hat esModuleInterop nicht aktiviert (Konvention siehe apps/api/src/main.ts).
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import type { CustomFetchOptions } from 'openid-client';

/**
 * BugFix-06 (Teil 2): Minimaler, TLS-relaxierender `fetch`-Ersatz.
 *
 * Wird ausschliesslich fuer OIDC-Aufrufe (Discovery, Token, Userinfo)
 * verwendet, wenn die Admin-Einstellung `CONNECTIVITY_ALLOW_SELF_SIGNED`
 * aktiv ist (selbst signierte Provider-Zertifikate). Der Request laeuft
 * ueber `node:https` mit `rejectUnauthorized: false` und liefert ein
 * natives `Response`-Objekt, damit `openid-client` uneingeschraenkt
 * weiterarbeiten kann. Bewusst KEIN globaler Effekt: Alle anderen
 * Requests der Anwendung behalten die strikte TLS-Validierung.
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
    // https.RequestOptions erbt von http.RequestOptions und ergaenzt
    // `rejectUnauthorized` (bei http-URLs wird der ueberzaehlige Wert
    // zur Laufzeit schlicht ignoriert).
    const options: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(headers.entries()),
      // Die Lockerung dieser einen Request-Klasse: Zertifikatsvalidierung aus.
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
