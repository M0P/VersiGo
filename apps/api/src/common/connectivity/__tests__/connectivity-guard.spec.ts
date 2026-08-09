import { describe, expect, it, vi, beforeEach } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup }));

import {
  assertSafeTestEndpoint,
  isBlockedIpv4,
  isBlockedIpv6,
  isCloudMetadataAddress,
  UnsafeEndpointError,
} from '../connectivity-guard';

describe('connectivity-guard (SSRF-Schutz)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks non-http(s) protocols', async () => {
    await expect(assertSafeTestEndpoint('ftp://example.com/file')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('file:///etc/passwd')).rejects.toThrow(
      UnsafeEndpointError,
    );
  });

  it('blocks invalid URLs', async () => {
    await expect(assertSafeTestEndpoint('not a url')).rejects.toThrow(UnsafeEndpointError);
  });

  it('blocks private/loopback/link-local/metadata IPv4 literals', async () => {
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

  it('allows public IPv4 literals', async () => {
    await expect(assertSafeTestEndpoint('http://8.8.8.8/')).resolves.toBeUndefined();
    await expect(assertSafeTestEndpoint('https://93.184.216.34/')).resolves.toBeUndefined();
  });

  it('blocks local/private IPv6 literals', async () => {
    const blocked = ['::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1'];
    for (const ip of blocked) {
      await expect(assertSafeTestEndpoint(`http://[${ip}]/`)).rejects.toThrow(
        UnsafeEndpointError,
      );
    }
  });

  it('blocks localhost and internal hostnames', async () => {
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

  it('rejects DNS names that resolve to blocked addresses', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);
    await expect(assertSafeTestEndpoint('http://example.com/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    expect(lookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
  });

  it('allows DNS names that resolve to public addresses', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeTestEndpoint('https://example.com/')).resolves.toBeUndefined();
  });

  it('proceeds when DNS resolution fails (the fetch reports the error)', async () => {
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
    // IPv4-mapped: dotted-quad AND canonical hex form (as URL.hostname
    // produces from ::ffff:127.0.0.1).
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpv6('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedIpv6('::ffff:808:808')).toBe(false);
  });
});

describe('connectivity-guard (BugFix-06: opt-in relaxation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isCloudMetadataAddress recognizes the metadata literals of both families', () => {
    expect(isCloudMetadataAddress('169.254.169.254')).toBe(true);
    expect(isCloudMetadataAddress('fd00:ec2::254')).toBe(true);
    expect(isCloudMetadataAddress('192.168.1.1')).toBe(false);
    expect(isCloudMetadataAddress('127.0.0.1')).toBe(false);
    // IPv4-mapped IPv6 forms of the metadata address (BugFix-06 high fix)
    expect(isCloudMetadataAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isCloudMetadataAddress('::ffff:a9fe:a9fe')).toBe(true);
  });

  it('allowPrivate=true allows private/local IPv4 literals', async () => {
    const allowed = [
      'http://192.168.24.8:8010/api', // Paperless in the LAN (user-reported issue)
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://127.0.0.1:11434/', // Ollama localhost
      'http://100.64.0.1/',
    ];
    for (const url of allowed) {
      await expect(
        assertSafeTestEndpoint(url, { allowPrivate: true }),
      ).resolves.toBeUndefined();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('allowPrivate=true allows local hostnames (regardless of DNS resolution)', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.50', family: 4 }]);
    await expect(
      assertSafeTestEndpoint('http://papierkram.home:8010/api', { allowPrivate: true }),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeTestEndpoint('http://printer.local/', { allowPrivate: true }),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeTestEndpoint('http://localhost:11434/', { allowPrivate: true }),
    ).resolves.toBeUndefined();
  });

  it('allowPrivate=true still blocks the cloud metadata address', async () => {
    await expect(
      assertSafeTestEndpoint('http://169.254.169.254/latest/meta-data/', {
        allowPrivate: true,
      }),
    ).rejects.toThrow(UnsafeEndpointError);
    await expect(
      assertSafeTestEndpoint('http://[fd00:ec2::254]/', { allowPrivate: true }),
    ).rejects.toThrow(UnsafeEndpointError);
    // IPv4-mapped IPv6 forms of the metadata address must also
    // remain blocked in relaxed mode (BugFix-06 high fix).
    await expect(
      assertSafeTestEndpoint('http://[::ffff:169.254.169.254]/latest/meta-data/', {
        allowPrivate: true,
      }),
    ).rejects.toThrow(UnsafeEndpointError);
    await expect(
      assertSafeTestEndpoint('http://[::ffff:a9fe:a9fe]/', { allowPrivate: true }),
    ).rejects.toThrow(UnsafeEndpointError);
  });

  it('allowPrivate=true blocks DNS names that resolve to metadata', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      assertSafeTestEndpoint('https://metadata.example.com/', { allowPrivate: true }),
    ).rejects.toThrow(UnsafeEndpointError);
    expect(lookup).toHaveBeenCalled();
  });

  it('allowPrivate=true blocks DNS names that resolve to IPv4-mapped metadata', async () => {
    lookup.mockResolvedValue([{ address: '::ffff:a9fe:a9fe', family: 6 }]);
    await expect(
      assertSafeTestEndpoint('https://metadata-v6.example.com/', { allowPrivate: true }),
    ).rejects.toThrow(UnsafeEndpointError);
    expect(lookup).toHaveBeenCalled();
  });

  it('without allowPrivate the strict default behavior stays unchanged', async () => {
    await expect(assertSafeTestEndpoint('http://192.168.24.8:8010/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('http://127.0.0.1:11434/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('http://localhost/')).rejects.toThrow(
      UnsafeEndpointError,
    );
    await expect(assertSafeTestEndpoint('http://8.8.8.8/')).resolves.toBeUndefined();
  });
});
