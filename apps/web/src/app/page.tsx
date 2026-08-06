'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../components/ui/app-shell';
import { PageHeader } from '../components/ui/page-header';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert } from '../components/ui/alert';
import { NAV_SECTIONS } from '../components/ui/nav-config';
import { formatCurrency, useI18n } from '../i18n';
import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type PinnedPolicy = {
  id: string;
  type: string;
  insurerName: string;
  tariffName: string | null;
  contractNumber: string;
  renewalDate: string | null;
  premiumAmount: number | null;
};

export default function Page(): ReactElement {
  const { t, language } = useI18n();
  const [pinned, setPinned] = useState<PinnedPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/policies/pinned`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('dashboard.pinnedError'));
        return res.json();
      })
      .then((data) => { if (data) setPinned(data); })
      .catch((e: Error) => setError(e.message));
  }, [t]);

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('dashboard.title')} description={t('dashboard.welcome')} />
      <div className="split-layout">
        <Card>
          <h3>{t('dashboard.policiesTitle')}</h3>
          <p className="text-muted text-sm">{t('dashboard.policiesDescription')}</p>
          <a href="/policies" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            {t('dashboard.goToPolicies')}
          </a>
        </Card>
        <Card>
          <h3>{t('dashboard.costsTitle')}</h3>
          <p className="text-muted text-sm">{t('dashboard.costsDescription')}</p>
          <a href="/household/costs" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            {t('dashboard.goToCosts')}
          </a>
        </Card>
        <Card>
          <h3>{t('dashboard.settingsTitle')}</h3>
          <p className="text-muted text-sm">{t('dashboard.settingsDescription')}</p>
          <a href="/settings" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            {t('dashboard.goToSettings')}
          </a>
        </Card>
      </div>

      <section style={{ marginTop: 'var(--versigo-space-5)' }}>
        <h2 className="text-lg" style={{ marginBottom: 'var(--versigo-space-3)' }}>
          {t('dashboard.pinnedTitle')}
        </h2>
        {error ? (
          <Alert variant="danger">{t('common.error')}: {error}</Alert>
        ) : pinned.length === 0 ? (
          <Card>
            <p className="text-muted text-sm">{t('dashboard.pinnedEmpty')}</p>
            <a href="/policies" style={{ display: 'inline-flex', marginTop: 'var(--versigo-space-3)' }}>
              <Button variant="secondary" size="sm">{t('dashboard.goToPolicies')}</Button>
            </a>
          </Card>
        ) : (
          <div className="split-layout">
            {pinned.map((p) => (
              <Card key={p.id}>
                <span className="badge badge-primary">{t('policies.pinned')}</span>
                <h3 style={{ marginTop: 'var(--versigo-space-2)' }}>{p.insurerName}</h3>
                <p className="text-sm text-muted">
                  {t(`policies.types.${p.type}`) ?? p.type}
                  {p.tariffName ? ` - ${p.tariffName}` : ''}
                </p>
                <p className="text-sm">{t('policies.contractNumber')}: {p.contractNumber}</p>
                {p.renewalDate && (
                  <p className="text-sm">{t('policies.renewalDate')}: {new Date(p.renewalDate).toLocaleDateString(language)}</p>
                )}
                {p.premiumAmount != null && (
                  <p className="text-sm">{t('policies.premium')}: {formatCurrency(p.premiumAmount, language)}</p>
                )}
                <div style={{ marginTop: 'var(--versigo-space-3)' }}>
                  <a href={`/policies/${p.id}`}>
                    <Button variant="secondary" size="sm">{t('policies.details')}</Button>
                  </a>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
