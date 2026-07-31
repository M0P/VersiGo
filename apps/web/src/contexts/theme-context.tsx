'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactElement,
  type ReactNode,
} from 'react';
import { hexToHSL, hslToHex, normalizeHS } from '../lib/colour-utils';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Preset accent colours a user can pick from. */
const ACCENT_PRESETS = [
  { name: 'Blau', h: 210, s: 50 },
  { name: 'Grün', h: 145, s: 45 },
  { name: 'Violett', h: 270, s: 45 },
  { name: 'Orange', h: 25, s: 70 },
  { name: 'Rot', h: 0, s: 60 },
  { name: 'Türkis', h: 180, s: 45 },
  { name: 'Rosa', h: 330, s: 50 },
  { name: 'Indigo', h: 240, s: 40 },
] as const;

export { ACCENT_PRESETS };

type ThemeContextValue = {
  /** The current accent hue. */
  accentH: number;
  /** The current accent saturation. */
  accentS: number;
  /** The current theme mode. */
  theme: 'light' | 'dark';
  /** Whether a colour preference has been loaded. */
  loaded: boolean;
  /** Set a new accent colour (persists to server). */
  setAccent: (h: number, s: number) => Promise<void>;
  /** Toggle between light and dark. */
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULT_H = 210;
const DEFAULT_S = 50;

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [accentH, setAccentH] = useState(DEFAULT_H);
  const [accentS, setAccentS] = useState(DEFAULT_S);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [loaded, setLoaded] = useState(false);
  // Gates the DOM/localStorage sync effects until the values applied by the
  // inline bootstrap script have been read. Without this gate the sync effects
  // would run on mount with the default state and overwrite the pre-painted
  // theme/accent (flash of default colours + clobbered localStorage cache).
  const [ready, setReady] = useState(false);

  // Read the theme/accent applied by the inline bootstrap script, then load
  // the server-persisted accent colour.
  useEffect(() => {
    let cancelled = false;

    // Honor the theme already set by the inline bootstrap script (no flash).
    // Falls back to the system colour scheme if nothing was set.
    const initialTheme = document.documentElement.getAttribute('data-theme');
    if (initialTheme === 'light' || initialTheme === 'dark') {
      setTheme(initialTheme);
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setTheme(mq.matches ? 'dark' : 'light');
    }

    // Restore the accent from the CSS custom properties the bootstrap script set.
    const root = document.documentElement;
    const hRaw = root.style.getPropertyValue('--insura-accent-h');
    const sRaw = root.style.getPropertyValue('--insura-accent-s');
    const h = Number.parseFloat(hRaw);
    const s = Number.parseFloat(sRaw);
    if (Number.isFinite(h) && Number.isFinite(s)) {
      const normalized = normalizeHS(h, s);
      setAccentH(normalized.h);
      setAccentS(normalized.s);
    }

    // Values are settled – allow the sync effects to run with correct state.
    setReady(true);

    async function loadPreference() {
      try {
        const res = await fetch(`${API_BASE}/user/preferences/ui:accentColour`, {
          credentials: 'include',
        });

        if (res.ok) {
          const data: { value: string } = await res.json();
          if (data.value && !cancelled) {
            const hsl = hexToHSL(data.value);
            if (hsl) {
              setAccentH(hsl.h);
              setAccentS(hsl.s);
            }
          }
        }
      } catch {
        // Silently fall back to defaults
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void loadPreference();

    return () => {
      cancelled = true;
    };
  }, []);

  // Apply CSS custom properties when accent changes (after initial values are settled)
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.style.setProperty('--insura-accent-h', String(accentH));
    root.style.setProperty('--insura-accent-s', `${accentS}%`);
    root.style.setProperty('--insura-accent-l', '50%');
    // Derived values
    root.style.setProperty('--insura-accent', `hsl(${accentH}, ${accentS}%, 50%)`);
    root.style.setProperty('--insura-accent-light', `hsl(${accentH}, ${accentS}%, 85%)`);
    root.style.setProperty('--insura-accent-dark', `hsl(${accentH}, ${accentS}%, 35%)`);
    root.style.setProperty('--insura-accent-soft', `hsl(${accentH}, ${accentS}%, 95%)`);
    root.style.setProperty('--insura-accent-text', `hsl(${accentH}, ${accentS}%, 98%)`);
    root.style.setProperty('--insura-accent-on-dark', `hsl(${accentH}, ${accentS}%, 90%)`);
    root.style.setProperty('--insura-focus-color', `var(--insura-accent)`);
    // Cache for the inline bootstrap script on the next visit
    try {
      localStorage.setItem('insura:accent', JSON.stringify({ h: accentH, s: accentS }));
    } catch {
      // Ignore storage failures (e.g. private mode)
    }
  }, [accentH, accentS, ready]);

  // Apply theme attribute (after initial values are settled)
  useEffect(() => {
    if (!ready) return;
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('insura:theme', theme);
    } catch {
      // Ignore storage failures (e.g. private mode)
    }
  }, [theme, ready]);

  const setAccent = useCallback(async (h: number, s: number) => {
    setAccentH(h);
    setAccentS(s);

    // Convert HSL back to hex for storage
    const hex = hslToHex(h, s);
    try {
      await fetch(`${API_BASE}/user/preferences/ui:accentColour`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: hex }),
      });
    } catch {
      // Silently fail – the UI still has the colour applied
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <ThemeContext.Provider value={{ accentH, accentS, theme, loaded, setAccent, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the current theme context.
 * Must be used within a ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}


