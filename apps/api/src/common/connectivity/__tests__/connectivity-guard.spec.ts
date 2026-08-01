import { describe, expect, it, vi, beforeEach } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup }));

import {
  assertSafeTestEndpoint,
  isBlockedIpv4,
  isBlockedIpv6,
  UnsafeEndpointError,
} from '../connectivity-guard';

describe('connectivity-guard (SSRF-Schutz)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blockiert nicht-http(s)-Protokolle', async () => {
    await expect(assertSafeTestEndpoint('ftp://example.com/file')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('file:///etc/passwd')).rejects.toThrow(
      UnsafeEndpointError,
    );
  });

  it('blockiert ungueltige URLs', async () => {
    await expect(assertSafeTestEndpoint('keine url')).rejects.toThrow(UnsafeEndpointError);
  });

  it('blockiert private/loopback/link-local/metadata IPv4-Literale', async () => {
    const blocked = [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '224.0.0.1',
    ];
    for (const ip of blocked) {
      await expect(assertSafeTestEndpoint(`http://${ip}/api`)).rejects.toThrow(
        UnsafeEndpointError,
      );
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('erlaubt oeffentliche IPv4-Literale', async () => {
    await expect(assertSafeTestEndpoint('http://8.8.8.8/')).resolves.toBeUndefined();
    await expect(assertSafeTestEndpoint('https://93.184.216.34/')).resolves.toBeUndefined();
  });

  it('blockiert lokale/private IPv6-Literale', async () => {
    const blocked = ['::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1'];
    for (const ip of blocked) {
      await expect(assertSafeTestEndpoint(`http://[${ip}]/`)).rejects.toThrow(
        UnsafeEndpointError,
      );
    }
  });

  it('blockiert localhost und interne Hostnamen', async () => {
    await expect(assertSafeTestEndpoint('http://localhost:11434/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('http://api.internal/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('http://printer.local/')).rejects.toThrow(
      UnsafeEndpointError,
    );
  });

  it('weist DNS-Namen ab, die auf gesperrte Adressen aufloesen', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);
    await expect(assertSafeTestEndpoint('http://example.com/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    expect(lookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
  });

  it('erlaubt DNS-Namen, die auf oeffentliche Adressen aufloesen', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeTestEndpoint('https://example.com/')).resolves.toBeUndefined();
  });

  it('laeuft durch, wenn die DNS-Aufloesung fehlschlaegt (Fehler liefert der fetch)', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeTestEndpoint('https://unbekannt.example.com/')).resolves.toBeUndefined();
  });

  it('isBlockedIpv4/isBlockedIpv6 erkennen Literale korrekt', () => {
    expect(isBlockedIpv4('127.0.0.1')).toBe(true);
    expect(isBlockedIpv4('10.1.2.3')).toBe(true);
    expect(isBlockedIpv4('192.168.0.1')).toBe(true);
    expect(isBlockedIpv4('8.8.8.8')).toBe(false);
    expect(isBlockedIpv4('not-an-ip')).toBe(false);
    expect(isBlockedIpv6('::1')).toBe(true);
    expect(isBlockedIpv6('fc00::1')).toBe(true);
    expect(isBlockedIpv6('fe80::1')).toBe(true);
    expect(isBlockedIpv6('2001:4860:4860::8888')).toBe(false);
    // IPv4-mapped: Dotted-Quad UND kanonische Hex-Form (wie sie URL.hostname
    // aus ::ffff:127.0.0.1 erzeugt).
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedIpv6('::ffff:808:808')).toBe(false);
  });
});
