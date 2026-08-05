import { describe, it, expect } from 'vitest';
import { normalizePortalUrl } from '../lib/portal-url';

describe('normalizePortalUrl (BugFix-05, Befund 2)', () => {
  it('stellt https:// voran, wenn kein Schema angegeben ist', () => {
    expect(normalizePortalUrl('www.portal.de')).toBe('https://www.portal.de');
    expect(normalizePortalUrl('www.portal.de/login')).toBe('https://www.portal.de/login');
  });

  it('trimmt Leerraum vor der Normalisierung', () => {
    expect(normalizePortalUrl('  www.portal.de  ')).toBe('https://www.portal.de');
  });

  it('laesst http(s)://-URLs unveraendert', () => {
    expect(normalizePortalUrl('http://portal.example.com')).toBe('http://portal.example.com');
    expect(normalizePortalUrl('https://portal.example.com/login')).toBe('https://portal.example.com/login');
  });

  it('laesst andere Schemata mit :// unveraendert (server-seitige Validierung greift)', () => {
    // `javascript://` und `data://` haben ein Schema und bleiben unveraendert;
    // die Ablehnung uebernimmt @IsUrl (nur http/https) im Server-DTO.
    expect(normalizePortalUrl('javascript://alert(1)')).toBe('javascript://alert(1)');
    expect(normalizePortalUrl('data://x')).toBe('data://x');
  });

  it('gibt leere Eingaben unveraendert zurueck', () => {
    expect(normalizePortalUrl('')).toBe('');
    expect(normalizePortalUrl('   ')).toBe('');
  });
});
