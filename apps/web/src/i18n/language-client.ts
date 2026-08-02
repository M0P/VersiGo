/**
 * AP-21: API-Client fuer die Sprachpraeferenz (/user/language).
 *
 * Der Endpunkt ist fuer ALLE authentifizierten Rollen freigegeben
 * (READ_ONLY eingeschlossen). READ_ONLY-Aenderungen werden serverseitig
 * nur in der Sitzung gespeichert (persistence: 'session'); USER/ADMIN
 * erhalten eine dauerhafte Konto-Einstellung (persistence: 'persistent').
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export type LanguagePersistence = 'persistent' | 'session';

export type LanguagePreference = {
  language: string;
  persistence: LanguagePersistence;
};

/** Liest die aufgeloeste Sprachpraeferenz des angemeldeten Nutzers. */
export async function fetchLanguagePreference(): Promise<LanguagePreference | null> {
  try {
    const res = await fetch(`${API_BASE}/user/language`, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as LanguagePreference;
  } catch {
    return null;
  }
}

/** Speichert die Sprachwahl (READ_ONLY: nur Sitzung, USER/ADMIN: Konto). */
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
