'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/ui/loading';
import { Alert } from '../../components/ui/alert';
import { EmptyState } from '../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../components/ui/nav-config';
import { formatCurrency, useI18n } from '../../i18n';

type Policy = {
  id: string;
  type: string;
  insurerName: string;
  contractNumber: string;
  status: string;
  premiumAmount: number | null;
  startDate: string;
  pinnedAt: string | null;
};

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

export default function PolicyListPage(): ReactElement {
  const { t, language } = useI18n();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/policies`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('policies.errorLoading'));
        return res.json();
      })
      .then((data) => { if (data) setPolicies(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [t]);

  // Pin/Unpin toggle (BugFix-06, Teil 4): optimistisch mit Rueckfall auf den
  // Fehlerzustand – kein setState nach abgelaufenen Requests (Sequenz-Schutz).
  const togglePin = async (policy: Policy) => {
    const pinned = policy.pinnedAt != null;
    setPinningId(policy.id);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policy.id}/pin`, {
        method: pinned ? 'DELETE' : 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('policies.pinError'));
      const updated = await res.json();
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('policies.pinError'));
    } finally {
      setPinningId(null);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('policies.title')} />
        <Loading label={t('policies.loading')} />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('policies.title')} />
        <Alert variant="danger">{t('common.error')}: {error}</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('policies.title')}
        description={t('policies.description')}
        actions={<a href="/policies/new"><Button variant="primary">{t('policies.newPolicy')}</Button></a>}
      />

      {policies.length === 0 ? (
        <EmptyState icon="📋" title={t('policies.emptyTitle')}>
          <p>{t('policies.emptyBody')}</p>
          <a href="/policies/new"><Button variant="primary">{t('policies.createFirst')}</Button></a>
        </EmptyState>
      ) : (
        <div className="split-layout">
          {policies.map((p) => (
            <Card key={p.id}>
              {p.pinnedAt != null && <span className="badge badge-primary">{t('policies.pinned')}</span>}
              <h3>{p.insurerName}</h3>
              <p className="text-sm text-muted">{p.type}</p>
              <p className="text-sm">
                {t('policies.status')}{' '}
                <span className={`badge ${p.status === 'ACTIVE' ? 'badge-success' : p.status === 'CANCELLED' ? 'badge-warning' : 'badge-neutral'}`}>
                  {t(`policies.statuses.${p.status}`) ?? p.status}
                </span>
              </p>
              {p.premiumAmount != null && (
                <p className="text-sm">{t('policies.premium')}: {formatCurrency(p.premiumAmount, language)}</p>
              )}
              <div style={{ marginTop: 'var(--versigo-space-3)', display: 'flex', gap: 'var(--versigo-space-2)' }}>
                <a href={`/policies/${p.id}`}>
                  <Button variant="secondary" size="sm">{t('policies.details')}</Button>
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => togglePin(p)}
                  disabled={pinningId === p.id}
                >
                  {p.pinnedAt != null ? t('policies.unpin') : t('policies.pin')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
