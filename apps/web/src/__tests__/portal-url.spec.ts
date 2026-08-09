import { describe, it, expect } from 'vitest';
import { normalizePortalUrl } from '../lib/portal-url';

describe('normalizePortalUrl (BugFix-05, finding 2)', () => {
  it('prepends https:// when no scheme is given', () => {
    expect(normalizePortalUrl('www.portal.de')).toBe('https://www.portal.de');
    expect(normalizePortalUrl('www.portal.de/login')).toBe('https://www.portal.de/login');
  });

  it('trims whitespace before normalizing', () => {
    expect(normalizePortalUrl('  www.portal.de  ')).toBe('https://www.portal.de');
  });

  it('leaves http(s):// URLs unchanged', () => {
    expect(normalizePortalUrl('http://portal.example.com')).toBe('http://portal.example.com');
    expect(normalizePortalUrl('https://portal.example.com/login')).toBe('https://portal.example.com/login');
  });

  it('leaves other :// schemes unchanged (server-side validation applies)', () => {
    // `javascript://` and `data://` have a scheme and stay unchanged;
    // rejection is handled by @IsUrl (http/https only) in the server DTO.
    expect(normalizePortalUrl('javascript://alert(1)')).toBe('javascript://alert(1)');
    expect(normalizePortalUrl('data://x')).toBe('data://x');
  });

  it('returns empty inputs unchanged', () => {
    expect(normalizePortalUrl('')).toBe('');
    expect(normalizePortalUrl('   ')).toBe('');
  });
});
