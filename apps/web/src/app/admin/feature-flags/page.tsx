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
import { useI18n } from '../../../i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type FeatureFlag = {
  id: string;
  key: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function AdminFeatureFlagsPage(): ReactElement {
  const { t } = useI18n();
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
        if (!res.ok) throw new Error(t('admin.flags.loadError'));
        return res.json();
      })
      .then((data) => { if (data) setFlags(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFlags(); }, [t]);

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
        throw new Error(data.message ?? t('admin.flags.createError'));
      }
      setNewKey('');
      setNewEnabled(false);
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
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
        throw new Error(data.message ?? t('admin.flags.updateError'));
      }
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm(t('admin.flags.confirmDelete', { key }))) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? t('admin.flags.deleteError'));
      }
      loadFlags();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('admin.flags.title')} />
        <Loading label={t('admin.flags.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('admin.flags.title')} description={t('admin.flags.description')} />

      {error && <Alert variant="danger">{t('common.error')}: {error}</Alert>}

      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('admin.flags.newFlag')} />
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label">{t('admin.flags.key')}</label>
            <Input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              required
              placeholder={t('admin.flags.keyPlaceholder')}
            />
          </div>
          <div className="form-group">
            <label className="form-check">
              <input
                type="checkbox"
                checked={newEnabled}
                onChange={(e) => setNewEnabled(e.target.checked)}
              />
              {t('admin.flags.enabled')}
            </label>
          </div>
          <Button type="submit" variant="primary">{t('admin.flags.create')}</Button>
        </form>
      </Card>

      <Card>
        <SectionHeader title={t('admin.flags.existing')} />
        {flags.length === 0 ? (
          <EmptyState icon="🚩" title={t('admin.flags.emptyTitle')}>
            <p>{t('admin.flags.emptyBody')}</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.flags.key')}</th>
                  <th>{t('admin.flags.status')}</th>
                  <th>{t('admin.flags.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id}>
                    <td data-label={t('admin.flags.key')}><code>{f.key}</code></td>
                    <td data-label={t('admin.flags.status')}>
                      <span className={`badge ${f.enabled ? 'badge-success' : 'badge-neutral'}`}>
                        {f.enabled ? t('admin.flags.active') : t('admin.flags.inactive')}
                      </span>
                    </td>
                    <td data-label={t('admin.flags.actions')}>
                      <div className="btn-group">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleToggle(f.key, f.enabled)}
                        >
                          {f.enabled ? t('admin.flags.disable') : t('admin.flags.enable')}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(f.key)}>{t('admin.flags.delete')}</Button>
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
