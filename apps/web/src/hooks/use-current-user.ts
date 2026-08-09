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

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

/**
 * Loads the current (authenticated) user via /auth/me.
 *
 * - loading: true while the request is running
 * - user: null on a missing/invalid session (redirects to /login)
 * - forbidden: true for a session without a valid role (practically never;
 *   the SessionAuthGuard already rejects non-ACTIVE accounts)
 *
 * Acts as an additional UX layer (e.g. READ_ONLY sees no editable
 * settings). The actual enforcement happens server-side.
 *
 * Option `enabled: false` disables the fetch completely (returns
 * { user: null, loading: false }). This lets a caller pass an already
 * loaded user (e.g. from the page level) down to a component without
 * triggering a second /auth/me request (AP-16, no duplicates).
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
