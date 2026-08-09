/**
 * AP-21: API client for the language preference (/user/language).
 *
 * The endpoint is enabled for ALL authenticated roles
 * (READ_ONLY included). READ_ONLY changes are stored server-side
 * only in the session (persistence: 'session'); USER/ADMIN
 * get a persistent account setting (persistence: 'persistent').
 */

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

export type LanguagePersistence = 'persistent' | 'session';

export type LanguagePreference = {
  language: string;
  persistence: LanguagePersistence;
};

/** Reads the resolved language preference of the signed-in user. */
export async function fetchLanguagePreference(): Promise<LanguagePreference | null> {
  try {
    const res = await fetch(`${API_BASE}/user/language`, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as LanguagePreference;
  } catch {
    return null;
  }
}

/** Stores the language choice (READ_ONLY: session only, USER/ADMIN: account). */
export async function saveLanguagePreference(
  language: string,
): Promise<LanguagePreference | null> {
  try {
    const res = await fetch(`${API_BASE}/user/language`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    });
    if (!res.ok) return null;
    return (await res.json()) as LanguagePreference;
  } catch {
    return null;
  }
}
