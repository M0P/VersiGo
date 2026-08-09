import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF protection for server-side connectivity tests (AP-17, M4).
 *
 * Without it, server-side `fetch` calls could reach internally reachable
 * services (cloud metadata 169.254.169.254, container network, loopback)
 * and mirror their responses back to the admin UI. This guard ensures
 * that connectivity tests only run against public http(s) endpoints:
 *
 * - Only `http://` and `https://` are allowed.
 * - IP literals in blocked ranges (loopback, RFC-1918 private,
 *   link-local/metadata, CGNAT, benchmarking, multicast, reserved) are
 *   rejected - IPv4, IPv6 and IPv4-mapped IPv6.
 * - Local/internal hostnames (`localhost`, `*.local`, `*.internal`, ...)
 *   are rejected.
 * - DNS names are resolved; addresses that resolve into blocked ranges
 *   are rejected (protection against simple DNS rebinding).
 *
 * Known limitation (m7, accepted): the DNS check and the subsequent
 * `fetch()` call are separate resolutions - a DNS rebinding could in
 * theory switch to a private address between check and fetch (TOCTOU).
 * The guard is admin-initiated and limited by the catalog allowlist;
 * switching to address pinning would be considerably more effort and is
 * not justified for this purpose.
 *
 * Admin-initiated and additionally limited by the catalog allowlist -
 * this guard is the second line of defense. It deliberately allows ONLY
 * public http(s) endpoints: local services (localhost, private networks,
 * container DNS) are by design not testable through the UI.
 */

export class UnsafeEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeEndpointError';
  }
}

/**
 * Blocked IPv4 ranges as [start, end] Uint32 pairs
 * (RFC 5735 / RFC 6890 / IANA Special-Purpose Address Registries).
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 "this network"
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 RFC 1918
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 Loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 Link-Local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 RFC 1918
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 RFC 1918
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 Benchmarking
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 Multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 reserviert + 255.255.255.255
];

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

/** Is an IPv4 literal blocked? (true only for real literals, never for DNS names) */
export function isBlockedIpv4(ip: string): boolean {
  const numeric = ipv4ToUint32(ip);
  if (numeric === null) return false;
  return BLOCKED_IPV4_RANGES.some(([start, end]) => numeric >= start && numeric <= end);
}

/**
 * Extracts the embedded IPv4 address of an IPv4-mapped IPv6 literal
 * (`::ffff:127.0.0.1` dotted-quad or the canonical hex form `::ffff:7f00:1`,
 * which Node.js `URL.hostname` rewrites to dotted-quad). Returns null for
 * anything that is not an IPv4-mapped IPv6 literal.
 */
export function extractMappedIpv4(ip: string): string | null {
  const normalized = ip.toLowerCase();
  const mapped = /^::ffff:(.+)$/.exec(normalized);
  if (!mapped) return null;
  const embedded = mapped[1];
  if (embedded.includes('.')) {
    return isIP(embedded) === 4 ? embedded : null;
  }
  const [hi, lo] = embedded.split(':');
  if (hi === undefined || lo === undefined) return null;
  const a = parseInt(hi || '0', 16);
  const b = parseInt(lo || '0', 16);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
}

/** Is an IPv6 literal blocked? (loopback, ULA, link-local, multicast, unspecified, IPv4-mapped) */
export function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped IPv6: the embedded IPv4 address must be checked against
  // the IPv4 blocklist. Unusual ::ffff: forms (e.g. IPv4-compatible,
  // deprecated) are conservatively blocked.
  const mappedIpv4 = extractMappedIpv4(normalized);
  if (mappedIpv4 !== null) {
    return isBlockedIpv4(mappedIpv4);
  }
  if (/^::ffff:/.test(normalized)) {
    return true;
  }

  const firstHextet = normalized.split(':')[0];
  if (/^f[cd]/.test(firstHextet)) return true; // fc00::/7 ULA
  if (/^fe[89ab]/.test(firstHextet)) return true; // fe80::/10 Link-Local
  if (firstHextet.startsWith('ff')) return true; // ff00::/8 Multicast
  return false;
}

/** Is an IP address (literal) blocked for security reasons? */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return false;
}

/** Local/internal hostnames that must never be the target of a connectivity test. */
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.home.arpa')
  );
}

/**
 * Cloud metadata addresses that stay blocked EVEN with the SSRF
 * relaxation enabled (`CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS`). The cloud
 * metadata endpoints (AWS/GCP/Azure: 169.254.169.254, AWS IPv6
 * fd00:ec2::254) are the primary SSRF target — an end user who wants to
 * test local services must never reach them.
 */
const METADATA_IPV4 = 0xa9fea9fe; // 169.254.169.254

/** Cloud metadata address (IPv4 literal)? */
export function isCloudMetadataIpv4(ip: string): boolean {
  return ipv4ToUint32(ip) === METADATA_IPV4;
}

/** Cloud metadata address (IPv6 literal incl. IPv4-mapped forms)? */
export function isCloudMetadataIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === 'fd00:ec2::254') return true;
  // IPv4-mapped IPv6 (`::ffff:169.254.169.254` / `::ffff:a9fe:a9fe`)
  // targets the metadata address via IPv4-mapped sockets and must
  // therefore also be treated as metadata.
  const mappedIpv4 = extractMappedIpv4(normalized);
  return mappedIpv4 !== null && isCloudMetadataIpv4(mappedIpv4);
}

/** Cloud metadata address (literals of both families)? */
export function isCloudMetadataAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isCloudMetadataIpv4(address);
  if (version === 6) return isCloudMetadataIpv6(address);
  return false;
}

/**
 * Opt-in options for the connectivity test (BugFix-06). The relaxation
 * is activated exclusively via the admin settings
 * `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` / `CONNECTIVITY_ALLOW_SELF_SIGNED`;
 * the safe default stays strict.
 */
export interface EndpointSafetyOptions {
  /**
   * Allows local/private endpoints (RFC-1918, loopback, link-local,
   * CGNAT, local hostnames like localhost / *.local / *.home / *.internal).
   * Cloud metadata (169.254.169.254, fd00:ec2::254) stays ALWAYS blocked.
   */
  allowPrivate?: boolean;
}

/**
 * Checks an endpoint URL for SSRF safety. Throws `UnsafeEndpointError`
 * for non-http(s) protocols, blocked IP literals, local hostnames and
 * DNS names that resolve to blocked addresses. Returns nothing on success.
 *
 * With `{ allowPrivate: true }` (explicit admin opt-in) local/private
 * endpoints are allowed; the cloud metadata blocklist still applies.
 */
export async function assertSafeTestEndpoint(
  rawUrl: string,
  options: EndpointSafetyOptions = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeEndpointError('not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeEndpointError('only http:// and https:// are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();

  // `URL.hostname` returns IPv6 literals including square brackets ([::1]) —
  // strip them before the literal check so they are not resolved as DNS
  // names and accidentally allowed.
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const isLiteral = isIP(literal) !== 0;

  if (options.allowPrivate) {
    // Relaxed mode (BugFix-06, part 2): local/private endpoints are
    // allowed, only the cloud metadata addresses stay blocked.
    if (isLiteral) {
      if (isCloudMetadataAddress(literal)) {
        throw new UnsafeEndpointError(
          `Address '${literal}' is a blocked cloud metadata address`,
        );
      }
      return;
    }
    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      // Resolution failed: the subsequent fetch error carries the message.
      return;
    }
    for (const { address } of addresses) {
      if (isCloudMetadataAddress(address)) {
        throw new UnsafeEndpointError(
          `Hostname '${hostname}' resolves to the blocked cloud metadata address`,
        );
      }
    }
    return;
  }

  // Strict mode (default): the previous SSRF protection behavior.
  if (isBlockedHostname(hostname)) {
    throw new UnsafeEndpointError(
      `Hostname '${hostname}' is local/internal and blocked for connectivity tests`,
    );
  }

  if (isLiteral) {
    if (isBlockedAddress(literal)) {
      throw new UnsafeEndpointError(
        `Address '${literal}' is in a blocked range (local/private/metadata)`,
      );
    }
    return;
  }

  // DNS names: resolve and reject blocked resolutions.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    // Resolution failed (e.g. ENOTFOUND): do not block here —
    // the subsequent fetch error carries the actual message.
    return;
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeEndpointError(
        `Hostname '${hostname}' resolves to a blocked address (local/private/metadata)`,
      );
    }
  }
}
