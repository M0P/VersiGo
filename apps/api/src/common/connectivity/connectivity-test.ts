import * as https from 'node:https';
import axios, { type AxiosResponse } from 'axios';
import { assertSafeTestEndpoint, UnsafeEndpointError } from './connectivity-guard';

/**
 * HTTP connectivity test with optional TLS relaxation (BugFix-06, part 2).
 *
 * The test is the final step of the SSRF guard (`assertSafeTestEndpoint`):
 * the guard validates the URL first, this helper only performs the actual
 * request. The TLS relaxation (`rejectUnauthorized: false`) is enabled only
 * through the admin setting `CONNECTIVITY_ALLOW_SELF_SIGNED` and applies
 * ONLY to this test request, never globally.
 *
 * Redirects are NOT followed blindly: `maxRedirects: 0` disables axios'
 * internal redirect following, and every 3xx `Location` is re-validated
 * against the SSRF guard (with the same `allowPrivate` mode) before being
 * followed manually. This prevents a public endpoint from redirecting the
 * server-side request to a private/metadata address.
 */

export interface TestEndpointOptions {
  /** Optional Bearer token for protected endpoints. */
  token?: string;
  /** Timeout in milliseconds (default: 5000). */
  timeoutMs?: number;
  /**
   * Disable TLS certificate validation (self-signed certificates).
   * Only set when `CONNECTIVITY_ALLOW_SELF_SIGNED` is active.
   */
  rejectUnauthorized?: boolean;
  /**
   * Whether the SSRF guard runs in relaxed mode
   * (`CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS`). Redirect targets are
   * re-validated with the same mode.
   */
  allowPrivate?: boolean;
}

export interface TestEndpointResult {
  success: boolean;
  message: string;
}

/** Maximum number of redirects followed (each re-validated by the SSRF guard). */
const MAX_REDIRECTS = 5;

/**
 * Performs an HTTP GET connectivity test. `validateStatus: () => true` makes
 * axios resolve even 4xx/5xx responses; a status < 500 counts as "endpoint
 * reachable" (401/403 prove the service is running). 3xx responses are
 * re-validated against `assertSafeTestEndpoint` before being followed.
 */
export async function testEndpoint(
  url: string,
  options: TestEndpointOptions = {},
): Promise<TestEndpointResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  let currentUrl = url;
  // Origin (protocol + host + port) of the endpoint that was originally
  // checked: the integration token is only forwarded to redirects within
  // this origin (protection against open-redirect credential disclosure).
  let originalOrigin: string;
  try {
    originalOrigin = new URL(url).origin;
  } catch {
    originalOrigin = '';
  }

  for (let redirectCount = 0; ; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: AxiosResponse;
    try {
      const headers: Record<string, string> = {};
      if (options.token && new URL(currentUrl).origin === originalOrigin) {
        headers.Authorization = `Bearer ${options.token}`;
      }
      response = await axios.get(currentUrl, {
        signal: controller.signal,
        timeout: timeoutMs,
        // Never let axios follow redirects internally: every redirect target
        // is re-validated by the SSRF guard below.
        maxRedirects: 0,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        // Only use a TLS-relaxing agent when the opt-in is active – the
        // default fetch path of the Node agent is never changed.
        ...(options.rejectUnauthorized === false && currentUrl.startsWith('https:')
          ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
          : {}),
        // Error statuses are treated as "reachable" (see JSDoc).
        validateStatus: () => true,
      });
    } finally {
      clearTimeout(timer);
    }

    const status = response.status;
    if (status >= 300 && status < 400 && response.headers.location) {
      if (redirectCount >= MAX_REDIRECTS) {
        return { success: false, message: `HTTP ${status}: too many redirects` };
      }
      const nextUrl = new URL(response.headers.location, currentUrl).toString();
      // Re-validate each redirect target against the SSRF guard.
      try {
        await assertSafeTestEndpoint(nextUrl, { allowPrivate: options.allowPrivate });
      } catch (error: unknown) {
        if (error instanceof UnsafeEndpointError) {
          return { success: false, message: error.message };
        }
        throw error;
      }
      currentUrl = nextUrl;
      continue;
    }

    return {
      success: status < 500,
      message: `HTTP ${status}: ${response.statusText}`,
    };
  }
}
