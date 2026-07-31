import { describe, it, expect } from 'vitest';
import { validateHex, hexToHSL, hslToHex } from '../lib/colour-utils';

describe('validateHex', () => {
  it('should accept valid 6-digit hex with #', () => {
    expect(validateHex('#1a73e8')).toBe('#1a73e8');
  });

  it('should accept valid 6-digit hex without #', () => {
    expect(validateHex('ff6600')).toBe('#ff6600');
  });

  it('should accept valid 3-digit hex with #', () => {
    expect(validateHex('#1ae')).toBe('#11aaee');
  });

  it('should accept valid 3-digit hex without #', () => {
    expect(validateHex('abc')).toBe('#aabbcc');
  });

  it('should accept uppercase hex', () => {
    expect(validateHex('#FF6600')).toBe('#ff6600');
  });

  it('should reject invalid hex strings', () => {
    expect(validateHex('#xyz123')).toBeNull();
    expect(validateHex('#12')).toBeNull();
    expect(validateHex('#1234567')).toBeNull();
    expect(validateHex('hello')).toBeNull();
    expect(validateHex('')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(validateHex('  #1a73e8  ')).toBe('#1a73e8');
  });
});

describe('hexToHSL', () => {
  it('should convert a blue hex to correct HSL', () => {
    const result = hexToHSL('#1a73e8');
    expect(result).not.toBeNull();
    expect(result!.h).toBeCloseTo(214, -1); // Approx 217
    expect(result!.s).toBeGreaterThan(70); // High saturation
  });

  it('should convert a red hex to correct HSL', () => {
    const result = hexToHSL('#ff0000');
    expect(result).not.toBeNull();
    expect(result!.h).toBe(0);
    expect(result!.s).toBe(100);
  });

  it('should convert a green hex to correct HSL', () => {
    const result = hexToHSL('#00ff00');
    expect(result).not.toBeNull();
    expect(result!.h).toBe(120);
    expect(result!.s).toBe(100);
  });

  it('should convert black to HSL with 0 saturation', () => {
    const result = hexToHSL('#000000');
    expect(result).not.toBeNull();
    expect(result!.s).toBe(0);
  });

  it('should return null for invalid hex', () => {
    expect(hexToHSL('not-a-color')).toBeNull();
  });

  it('should handle 3-digit hex', () => {
    const result = hexToHSL('#1ae');
    expect(result).not.toBeNull();
  });
});

describe('hslToHex round-trips', () => {
  it('should round-trip a valid HSL value', () => {
    const hex = hslToHex(214, 81);
    expect(validateHex(hex)).toBe(hex);
    const hsl = hexToHSL(hex);
    expect(hsl).not.toBeNull();
    expect(hsl!.h).toBeCloseTo(214, 0);
  });

  it('should normalize negative hue', () => {
    const hex = hslToHex(-146, 81); // -146 ≡ 214
    const hsl = hexToHSL(hex);
    expect(hsl).not.toBeNull();
    expect(hsl!.h).toBeCloseTo(214, 0);
  });

  it('should normalize out-of-range hue', () => {
    const hex = hslToHex(574, 81); // 574 ≡ 214
    const hsl = hexToHSL(hex);
    expect(hsl).not.toBeNull();
    expect(hsl!.h).toBeCloseTo(214, 0);
  });

  it('should clamp saturation above 100', () => {
    const hex = hslToHex(0, 150);
    const hsl = hexToHSL(hex);
    expect(hsl).not.toBeNull();
    expect(hsl!.h).toBe(0);
    expect(hsl!.s).toBe(100);
  });

  it('should produce a pure red for h=0 s=100', () => {
    expect(hslToHex(0, 100)).toBe('#ff0000');
  });
});
