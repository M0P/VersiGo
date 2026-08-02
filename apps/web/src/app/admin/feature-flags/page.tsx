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
    if (!window.confirm(`Feature-Flag "${key}" wirklich löschen?`)) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Löschen');
      }
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Globale Feature-Flags" />
        <Loading label="Lade Feature-Flags..." />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Globale Feature-Flags" description="Feature-Flags systemweit steuern" />

      {error && <Alert variant="danger">Fehler: {error}</Alert>}

      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title="Neues Feature-Flag" />
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label">Key</label>
            <Input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              required
              placeholder="z. B. feature_x"
            />
          </div>
          <div className="form-group">
            <label className="form-check">
              <input
                type="checkbox"
                checked={newEnabled}
                onChange={(e) => setNewEnabled(e.target.checked)}
              />
              Aktiviert
            </label>
          </div>
          <Button type="submit" variant="primary">Anlegen</Button>
        </form>
      </Card>

      <Card>
        <SectionHeader title="Vorhandene Feature-Flags" />
        {flags.length === 0 ? (
          <EmptyState icon="🚩" title="Keine Feature-Flags">
            <p>Es sind noch keine Feature-Flags vorhanden.</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Status</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td data-label="Key"><code>{f.key}</code></td>
                    <td data-label="Status">
                      <span className={`badge ${f.enabled ? 'badge-success' : 'badge-neutral'}`}>
                        {f.enabled ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </td>
                    <td data-label="Aktionen">
                      <div className="btn-group">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleToggle(f.key, f.enabled)}
                        >
                          {f.enabled ? 'Deaktivieren' : 'Aktivieren'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(f.key)}>Löschen</Button>
                      </div>
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
