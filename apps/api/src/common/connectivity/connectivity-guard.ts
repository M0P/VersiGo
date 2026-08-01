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

/** Gesperrt ein IPv6-Literal? (Loopback, ULA, Link-Local, Multicast, unspecified, IPv4-mapped) */
export function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped IPv6: `::ffff:127.0.0.1` (Dotted-Quad) oder die kanonische
  // Hex-Form `::ffff:7f00:1`, in die Node.js `URL.hostname` die Dotted-Quad-
  // Variante umschreibt. Die eingebettete IPv4-Adresse muss gegen die
  // IPv4-Blockliste geprueft werden.
  const mapped = /^::ffff:(.+)$/.exec(normalized);
  if (mapped) {
    const embedded = mapped[1];
    if (embedded.includes('.')) {
      return isBlockedIpv4(embedded);
    }
    const [hi, lo] = embedded.split(':');
    if (hi !== undefined && lo !== undefined) {
      const a = parseInt(hi || '0', 16);
      const b = parseInt(lo || '0', 16);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const dotted = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
        return isBlockedIpv4(dotted);
      }
    }
    // Ungewoehnliche ::ffff:-Form (z. B. IPv4-kompatibel, veraltet):
    // konservativ blockieren.
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
 * Prueft eine Endpunkt-URL auf SSRF-Sicherheit. Wirft `UnsafeEndpointError`
 * fuer nicht-http(s)-Protokolle, gesperrte IP-Literale, lokale Hostnamen und
 * DNS-Namen, die auf gesperrte Adressen aufloesen. Liefert bei Erfolg nichts.
 */
export async function assertSafeTestEndpoint(rawUrl: string): Promise<void> {
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
  if (isBlockedHostname(hostname)) {
    throw new UnsafeEndpointError(
      `Hostname '${hostname}' ist lokal/intern und fuer Connectivity-Tests gesperrt`,
    );
  }

  // IPv6-Literale liefert `URL.hostname` inkl. eckiger Klammern ([::1]) –
  // vor der Literal-Pruefung entfernen, damit sie nicht als DNS-Name
  // aufgeloest und dann versehentlich erlaubt werden.
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  if (isIP(literal)) {
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
