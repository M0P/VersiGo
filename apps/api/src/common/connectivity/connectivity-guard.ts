import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF-Schutz fuer serverseitige Connectivity-Tests (AP-17, M4).
 *
 * Serverseitige `fetch`-Aufrufe koennen sonst intern erreichbare Dienste
 * ansprechen (Cloud-Metadata 169.254.169.254, Container-Netzwerk,
 * Loopback) und deren Antworten an die Admin-UI zurueckspiegeln. Dieser
 * Guard stellt sicher, dass Connectivity-Tests ausschliesslich gegen
 * oeffentliche http(s)-Endpunkte laufen:
 *
 * - Nur `http://` und `https://` sind erlaubt.
 * - IP-Literale in gesperrten Bereichen (Loopback, RFC-1918-Private,
 *   Link-Local/Metadata, CGNAT, Benchmarking, Multicast, reserviert)
 *   werden abgewiesen – IPv4, IPv6 und IPv4-mapped IPv6.
 * - Lokale/interne Hostnamen (`localhost`, `*.local`, `*.internal`, …)
 *   werden abgewiesen.
 * - DNS-Namen werden aufgeloest; Adressen, die auf gesperrte Bereiche
 *   zeigen, werden abgewiesen (Schutz gegen einfaches DNS-Rebinding).
 *
 * Bekannte Einschraenkung (m7, akzeptiert): Die DNS-Pruefung und der
 * nachfolgende `fetch()`-Aufruf sind getrennte Aufloesungen – ein DNS-
 * Rebinding kann zwischen Check und Fetch theoretisch auf eine private
 * Adresse wechseln (TOCTOU). Der Guard ist admin-initiiert und durch die
 * Katalog-Allowlist begrenzt; ein Wechsel auf Adress-Pinning waere mit
 * deutlich hoeherem Aufwand verbunden und ist fuer diesen Zweck nicht
 * gerechtfertigt.
 *
 * Admin-initiiert und zusaetzlich durch die Katalog-Allowlist begrenzt –
 * dieser Guard ist die zweite Verteidigungslinie. Er erlaubt bewusst NUR
 * oeffentliche http(s)-Endpunkte: lokale Dienste (localhost, private
 * Netze, Container-DNS) sind per Design nicht ueber die UI testbar.
 */

export class UnsafeEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeEndpointError';
  }
}

/**
 * Gesperrte IPv4-Bereiche als [start, end]-Uint32-Paare
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

/** Gesperrt ein IPv4-Literal? (true nur fuer echte Literale, nie fuer DNS-Namen) */
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

/** Gesperrt ein IPv6-Literal? (Loopback, ULA, Link-Local, Multicast, unspecified, IPv4-mapped) */
export function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped IPv6: Die eingebettete IPv4-Adresse muss gegen die
  // IPv4-Blockliste geprueft werden. Ungewoehnliche ::ffff:-Formen
  // (z. B. IPv4-kompatibel, veraltet) werden konservativ blockiert.
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

/** Gesperrt eine IP-Adresse (Literal) aus Sicherheitsgruenden? */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return false;
}

/** Lokale/interne Hostnamen, die nie Ziel eines Connectivity-Tests sein duerfen. */
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
 * Cloud-Metadata-Adressen, die AUCH bei aktivierter SSRF-Lockerung
 * (`CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS`) gesperrt bleiben. Die Cloud-
 * Metadata-Endpunkte (AWS/GCP/Azure: 169.254.169.254, AWS IPv6
 * fd00:ec2::254) sind das primaere SSRF-Ziel – ein Endanwender, der
 * lokale Dienste testen will, muss sie niemals erreichen.
 */
const METADATA_IPV4 = 0xa9fea9fe; // 169.254.169.254

/** Cloud-Metadata-Adresse (IPv4-Literal)? */
export function isCloudMetadataIpv4(ip: string): boolean {
  return ipv4ToUint32(ip) === METADATA_IPV4;
}

/** Cloud-Metadata-Adresse (IPv6-Literal inkl. IPv4-mapped-Formen)? */
export function isCloudMetadataIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === 'fd00:ec2::254') return true;
  // IPv4-mapped IPv6 (`::ffff:169.254.169.254` / `::ffff:a9fe:a9fe`)
  // zielt ueber IPv4-mapped-Sockets auf die Metadata-Adresse und muss
  // daher ebenfalls als Metadata behandelt werden.
  const mappedIpv4 = extractMappedIpv4(normalized);
  return mappedIpv4 !== null && isCloudMetadataIpv4(mappedIpv4);
}

/** Cloud-Metadata-Adresse (Literale beider Familien)? */
export function isCloudMetadataAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isCloudMetadataIpv4(address);
  if (version === 6) return isCloudMetadataIpv6(address);
  return false;
}

/**
 * Opt-in-Optionen fuer den Connectivity-Test (BugFix-06). Die Lockerung
 * wird ausschliesslich ueber die Admin-Einstellungen
 * `CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS` / `CONNECTIVITY_ALLOW_SELF_SIGNED`
 * aktiviert; der sichere Default bleibt strikt.
 */
export interface EndpointSafetyOptions {
  /**
   * Erlaubt lokale/private Endpunkte (RFC-1918, Loopback, Link-Local,
   * CGNAT, lokale Hostnamen wie localhost / *.local / *.home / *.internal).
   * Cloud-Metadata (169.254.169.254, fd00:ec2::254) bleibt IMMER gesperrt.
   */
  allowPrivate?: boolean;
}

/**
 * Prueft eine Endpunkt-URL auf SSRF-Sicherheit. Wirft `UnsafeEndpointError`
 * fuer nicht-http(s)-Protokolle, gesperrte IP-Literale, lokale Hostnamen und
 * DNS-Namen, die auf gesperrte Adressen aufloesen. Liefert bei Erfolg nichts.
 *
 * Mit `{ allowPrivate: true }` (explizite Admin-Opt-in) werden lokale/private
 * Endpunkte zugelassen; die Cloud-Metadata-Blockliste gilt unveraendert.
 */
export async function assertSafeTestEndpoint(
  rawUrl: string,
  options: EndpointSafetyOptions = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeEndpointError('keine gueltige URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeEndpointError('nur http:// und https:// sind erlaubt');
  }

  const hostname = parsed.hostname.toLowerCase();

  // IPv6-Literale liefert `URL.hostname` inkl. eckiger Klammern ([::1]) –
  // vor der Literal-Pruefung entfernen, damit sie nicht als DNS-Name
  // aufgeloest und dann versehentlich erlaubt werden.
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const isLiteral = isIP(literal) !== 0;

  if (options.allowPrivate) {
    // Lockerungsmodus (BugFix-06, Teil 2): lokale/private Endpunkte sind
    // erlaubt, nur die Cloud-Metadata-Adressen bleiben gesperrt.
    if (isLiteral) {
      if (isCloudMetadataAddress(literal)) {
        throw new UnsafeEndpointError(
          `Adresse '${literal}' ist eine gesperrte Cloud-Metadata-Adresse`,
        );
      }
      return;
    }
    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      // Aufloesung fehlgeschlagen: der nachfolgende fetch-Fehler liefert die Meldung.
      return;
    }
    for (const { address } of addresses) {
      if (isCloudMetadataAddress(address)) {
        throw new UnsafeEndpointError(
          `Hostname '${hostname}' loest auf die gesperrte Cloud-Metadata-Adresse auf`,
        );
      }
    }
    return;
  }

  // Striker Modus (Default): bisheriges SSRF-Schutzverhalten.
  if (isBlockedHostname(hostname)) {
    throw new UnsafeEndpointError(
      `Hostname '${hostname}' ist lokal/intern und fuer Connectivity-Tests gesperrt`,
    );
  }

  if (isLiteral) {
    if (isBlockedAddress(literal)) {
      throw new UnsafeEndpointError(
        `Adresse '${literal}' liegt in einem gesperrten Bereich (lokal/privat/metadata)`,
      );
    }
    return;
  }

  // DNS-Namen: aufloesen und gesperrte Aufloesungen abweisen.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    // Aufloesung fehlgeschlagen (z. B. ENOTFOUND): hier nicht blockieren –
    // der nachfolgende fetch-Fehler liefert die eigentliche Meldung.
    return;
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeEndpointError(
        `Hostname '${hostname}' loest auf eine gesperrte Adresse auf (lokal/privat/metadata)`,
      );
    }
  }
}
