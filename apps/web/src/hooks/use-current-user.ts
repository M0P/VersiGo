'use client';

import { useEffect, useState } from 'react';

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: 'READ_ONLY' | 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED' | 'PENDING_APPROVAL';
  memberships: { householdId: string }[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/**
 * Laedt den aktuellen (authentifizierten) User ueber /auth/me.
 *
 * - loading: true, solange der Request laeuft
 * - user: null bei fehlender/ungueltiger Session (leitet nach /login um)
 * - forbidden: true bei einer Session ohne gueltige Rolle (praktisch nie;
 *   der SessionAuthGuard weist nicht-ACTIVE-Konten bereits ab)
 *
 * Dient als zusaetzliche UX-Ebene (z. B. READ_ONLY keine editierbaren
 * Einstellungen anzeigen). Die eigentliche Durchsetzung erfolgt serverseitig.
 *
 * Option `enabled: false` unterbindet den Fetch vollstaendig (liefert
 * { user: null, loading: false }). Damit kann ein Aufrufer einen bereits
 * geladenen User (z. B. vom Page-Level) an eine Komponente durchreichen,
 * ohne einen zweiten /auth/me-Request auszuloesen (AP-16, keine Duplikate).
 */
export function useCurrentUser(opts?: { enabled?: boolean }): {
  user: CurrentUser | null;
  loading: boolean;
} {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (opts?.enabled === false) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) {
          if (!cancelled) window.location.href = '/login';
          return null;
        }
        if (!res.ok) return null;
        return res.json() as Promise<CurrentUser>;
      })
      .then((data) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [opts?.enabled]);

  return { user, loading };
}
