'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type GlobalSetting = {
  id: string;
  key: string;
  isSecret: boolean;
  valuePlain: string;
  createdAt: string;
  updatedAt: string;
};

export default function AdminSettingsPage(): ReactElement {
  const [settings, setSettings] = useState<GlobalSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newIsSecret, setNewIsSecret] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editIsSecret, setEditIsSecret] = useState(false);

  const loadSettings = () => {
    setLoading(true);
    fetch(`${API_BASE}/admin/settings`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler beim Laden');
        return res.json();
      })
      .then((data) => { if (data) setSettings(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSettings(); }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey, valuePlain: newValue, isSecret: newIsSecret }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Anlegen');
      }
      setNewKey('');
      setNewValue('');
      setNewIsSecret(false);
      loadSettings();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  const handleUpdate = async (key: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/settings/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valuePlain: editValue, isSecret: editIsSecret }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Aktualisieren');
      }
      setEditKey(null);
      loadSettings();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm(`Setting "${key}" wirklich l\u00F6schen?`)) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/settings/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim L\u00F6schen');
      }
      loadSettings();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  if (loading) return <main><p>Lade Einstellungen...</p></main>;

  return (
    <div>
      <h1>Globale Einstellungen</h1>

      {error && <p style={{ color: 'red' }}>Fehler: {error}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Neues Setting</h2>
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
            <label style={{ display: 'block', fontSize: '0.8rem' }}>Wert</label>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{ padding: '0.3rem' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={newIsSecret}
                onChange={(e) => setNewIsSecret(e.target.checked)}
              />{' '}
              Secret (verschl&uuml;sselt)
            </label>
          </div>
          <button type="submit" style={{ padding: '0.3rem 0.8rem' }}>Anlegen</button>
        </form>
      </section>

      <section>
        <h2>Vorhandene Einstellungen</h2>
        {settings.length === 0 && <p>Keine Einstellungen vorhanden.</p>}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Key</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Wert</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Secret</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((s) => (
              <tr key={s.id}>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  <code>{s.key}</code>
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  {editKey === s.key ? (
                    <input
                      type={s.isSecret ? 'password' : 'text'}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      style={{ padding: '0.3rem' }}
                    />
                  ) : (
                    <span>{s.valuePlain}</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  {editKey === s.key ? (
                    <input
                      type="checkbox"
                      checked={editIsSecret}
                      onChange={(e) => setEditIsSecret(e.target.checked)}
                    />
                  ) : (
                    <span>{s.isSecret ? 'Ja' : 'Nein'}</span>
                  )}
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  {editKey === s.key ? (
                    <>
                      <button onClick={() => handleUpdate(s.key)} style={{ marginRight: '0.3rem' }}>Speichern</button>
                      <button onClick={() => setEditKey(null)}>Abbrechen</button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditKey(s.key); setEditValue(''); setEditIsSecret(s.isSecret); }}
                        style={{ marginRight: '0.3rem' }}
                      >
                        Bearbeiten
                      </button>
                      <button onClick={() => handleDelete(s.key)} style={{ color: 'red' }}>L&ouml;schen</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
