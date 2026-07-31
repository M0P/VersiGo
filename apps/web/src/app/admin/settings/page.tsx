'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';

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
    if (!window.confirm(`Setting "${key}" wirklich löschen?`)) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/settings/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Löschen');
      }
      loadSettings();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Globale Einstellungen" />
        <Loading label="Lade Einstellungen..." />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Globale Einstellungen" description="Systemweite Konfigurationswerte verwalten" />

      {error && <Alert variant="danger">Fehler: {error}</Alert>}

      <Card style={{ marginBottom: 'var(--insura-space-6)' }}>
        <SectionHeader title="Neues Setting" />
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--insura-space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label">Key</label>
            <Input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              required
              placeholder="z. B. integration.api_key"
            />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label">Wert</label>
            <Input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Wert eingeben"
            />
          </div>
          <div className="form-group">
            <label className="form-check">
              <input
                type="checkbox"
                checked={newIsSecret}
                onChange={(e) => setNewIsSecret(e.target.checked)}
              />
              Secret
            </label>
          </div>
          <Button type="submit" variant="primary">Anlegen</Button>
        </form>
      </Card>

      <Card>
        <SectionHeader title="Vorhandene Einstellungen" />
        {settings.length === 0 ? (
          <EmptyState icon="⚙️" title="Keine Einstellungen">
            <p>Es sind noch keine globalen Einstellungen vorhanden.</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Wert</th>
                  <th>Secret</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Key"><code>{s.key}</code></td>
                    <td data-label="Wert">
                      {editKey === s.key ? (
                        <Input
                          type={s.isSecret ? 'password' : 'text'}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                      ) : (
                        <span>{s.valuePlain}</span>
                      )}
                    </td>
                    <td data-label="Secret">
                      {editKey === s.key ? (
                        <label className="form-check">
                          <input
                            type="checkbox"
                            checked={editIsSecret}
                            onChange={(e) => setEditIsSecret(e.target.checked)}
                          />
                        </label>
                      ) : (
                        <span>{s.isSecret ? 'Ja' : 'Nein'}</span>
                      )}
                    </td>
                    <td data-label="Aktionen">
                      {editKey === s.key ? (
                        <div className="btn-group">
                          <Button variant="primary" size="sm" onClick={() => handleUpdate(s.key)}>Speichern</Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditKey(null)}>Abbrechen</Button>
                        </div>
                      ) : (
                        <div className="btn-group">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { setEditKey(s.key); setEditValue(''); setEditIsSecret(s.isSecret); }}
                          >
                            Bearbeiten
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(s.key)}>Löschen</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
