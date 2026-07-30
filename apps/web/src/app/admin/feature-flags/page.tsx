'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type FeatureFlag = {
  id: string;
  key: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function AdminFeatureFlagsPage(): ReactElement {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newEnabled, setNewEnabled] = useState(false);

  const loadFlags = () => {
    setLoading(true);
    fetch(`${API_BASE}/admin/feature-flags`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler beim Laden');
        return res.json();
      })
      .then((data) => { if (data) setFlags(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFlags(); }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/feature-flags`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey, enabled: newEnabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Anlegen');
      }
      setNewKey('');
      setNewEnabled(false);
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  const handleToggle = async (key: string, currentEnabled: boolean) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Aktualisieren');
      }
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm(`Feature-Flag "${key}" wirklich l\u00F6schen?`)) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim L\u00F6schen');
      }
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  if (loading) return <main><p>Lade Feature-Flags...</p></main>;

  return (
    <div>
      <h1>Globale Feature-Flags</h1>

      {error && <p style={{ color: 'red' }}>Fehler: {error}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Neues Feature-Flag</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem' }}>Key</label>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              required
              style={{ padding: '0.3rem' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={newEnabled}
                onChange={(e) => setNewEnabled(e.target.checked)}
              />{' '}
              Aktiviert
            </label>
          </div>
          <button type="submit" style={{ padding: '0.3rem 0.8rem' }}>Anlegen</button>
        </form>
      </section>

      <section>
        <h2>Vorhandene Feature-Flags</h2>
        {flags.length === 0 && <p>Keine Feature-Flags vorhanden.</p>}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Key</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Status</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id}>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  <code>{f.key}</code>
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  <span style={{ color: f.enabled ? 'green' : 'red', fontWeight: 'bold' }}>
                    {f.enabled ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  <button
                    onClick={() => handleToggle(f.key, f.enabled)}
                    style={{ marginRight: '0.3rem' }}
                  >
                    {f.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  </button>
                  <button onClick={() => handleDelete(f.key)} style={{ color: 'red' }}>L&ouml;schen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
