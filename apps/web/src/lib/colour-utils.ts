/**
 * Shared colour utility functions for the design system.
 *
 * These are extracted from the theme context so they can be
 * imported and tested without pulling in JSX or React.
 */

/**
 * Normalizes a hue value to 0–360 and saturation to 0–100.
 */
export function normalizeHS(h: number, s: number): { h: number; s: number } {
  return {
    h: ((h % 360) + 360) % 360,
    s: Math.max(0, Math.min(100, s)),
  };
}

/**
 * Validates a 3- or 6-digit hex colour string.
 * Returns the normalised hex string (with #) or null.
 */
export function validateHex(hex: string): string | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const [r, g, b] = cleaned.split('').map((c: string) => c.repeat(2));
    return `#${r}${g}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return null;
}

/**
 * Converts a hex colour string to HSL.
 * Returns { h, s } or null for invalid input.
 */
export function hexToHSL(hex: string): { h: number; s: number } | null {
  const validated = validateHex(hex);
  if (!validated) return null;

  const r = Number.parseInt(validated.slice(1, 3), 16) / 255;
  const g = Number.parseInt(validated.slice(3, 5), 16) / 255;
  const b = Number.parseInt(validated.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
    case g: h = ((b - r) / d + 2) * 60; break;
    case b: h = ((r - g) / d + 4) * 60; break;
  }

  return normalizeHS(Math.round(h), Math.round(s * 100));
}

/**
 * Converts HSL to a hex colour string (#rrggbb).
 * Lightness is fixed at 50 %. Hue and saturation are normalized first.
 */
export function hslToHex(h: number, s: number): string {
  const { h: hNorm, s: sNorm } = normalizeHS(h, s);
  const l = 50; // We always use 50% lightness for the accent
  const sRatio = sNorm / 100;
  const lNorm = l / 100;

  const a = sRatio * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => {
    const k = (n + hNorm / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };

  return `#${f(0)}${f(8)}${f(4)}`;
}
