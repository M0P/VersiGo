'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { formatCurrency, formatDate, useI18n } from '../../../i18n';
import CoverageSummarySection from './coverage-summary-section';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type PolicyDetail = {
  id: string;
  type: string;
  insurerName: string;
  insurerPortalUrl: string | null;
  contractNumber: string;
  tariffName: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  renewalDate: string | null;
  noticePeriod: number | null;
  paymentFrequency: string | null;
  premiumAmount: number | null;
  deductibleAmount: number | null;
  coverageSummaryShort: string | null;
  source: string;
  createdAt: string;
  archivedAt: string | null;
  coveredPersons: { id: string; personName: string; relationType: string }[];
  portalLinks: {
    id: string;
    providerKey: string;
    portalUrl: string | null;
    accessHint: string | null;
    deepLinkUrl: string | null;
    catalog: { providerKey: string; displayName: string } | null;
    connector: { key: string; displayName: string; experimental: boolean; available: boolean } | null;
  }[];
};

export default function PolicyDetailPage(): ReactElement {
  const params = useParams();
  const policyId = params.id as string;
  const { t, language } = useI18n();
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/policies/${policyId}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('policies.notFound'));
        return res.json();
      })
      .then((data) => { if (data) setPolicy(data); })
      .catch(() => setPolicy(null))
      .finally(() => setLoading(false));
  }, [policyId, t]);

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <Loading label={t('policies.detailLoading')} />
      </AppShell>
    );
  }

  if (!policy) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('policies.detailTitle')} />
        <Alert variant="danger">{t('policies.notFoundAlert')}</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={policy.insurerName}
        description={`${t(`policies.types.${policy.type}`) ?? policy.type} • ${t(`policies.statuses.${policy.status}`) ?? policy.status}`}
        actions={
          <a href="/policies">
            <Button variant="secondary" size="sm">{t('policies.backToOverview')}</Button>
          </a>
        }
      />

      <div className="split-layout">
        <Card>
          <SectionHeader title={t('policies.masterData')} />
          <dl style={{ margin: 0 }}>
            <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.contractNumber')}</dt>
            <dd style={{ margin: 0 }}>{policy.contractNumber}</dd>

            {policy.tariffName && (
              <>
                <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.tariff')}</dt>
                <dd style={{ margin: 0 }}>{policy.tariffName}</dd>
              </>
            )}

            <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('common.status')}</dt>
            <dd style={{ margin: 0 }}>
              <span className={`badge ${policy.status === 'ACTIVE' ? 'badge-success' : policy.status === 'CANCELLED' ? 'badge-warning' : 'badge-neutral'}`}>
                {t(`policies.statuses.${policy.status}`) ?? policy.status}
              </span>
            </dd>

            <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.startDate')}</dt>
            <dd style={{ margin: 0 }}>{formatDate(policy.startDate, language)}</dd>

            {policy.endDate && (
              <>
                <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.endDate')}</dt>
                <dd style={{ margin: 0 }}>{formatDate(policy.endDate, language)}</dd>
              </>
            )}

            {policy.premiumAmount != null && (
              <>
                <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.premium')}</dt>
                <dd style={{ margin: 0 }}>{formatCurrency(policy.premiumAmount, language)}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card>
          <SectionHeader title={t('policies.coveredPersons')} />
          {policy.coveredPersons.length === 0 ? (
            <EmptyState icon="👤" title={t('policies.noPersonsTitle')}>
              <p>{t('policies.noPersonsBody')}</p>
            </EmptyState>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--versigo-space-4)' }}>
              {policy.coveredPersons.map((p) => (
                <li key={p.id}>{p.personName} ({p.relationType})</li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title={t('policies.portalLinks')} />
          {policy.portalLinks.length === 0 ? (
            <EmptyState icon="🔗" title={t('policies.noLinksTitle')}>
              <p>{t('policies.noLinksBody')}</p>
            </EmptyState>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--versigo-space-4)', listStyle: 'none' }}>
              {policy.portalLinks.map((l) => {
                const displayName = l.catalog?.displayName ?? l.providerKey;
                const targetUrl = l.deepLinkUrl ?? l.portalUrl;
                return (
                  <li key={l.id} style={{ marginBottom: 'var(--versigo-space-3)' }}>
                    <strong>{displayName}</strong>
                    {l.connector && (
                      <span className={`badge ${l.connector.available ? 'badge-success' : 'badge-neutral'}`}
                        style={{ marginLeft: 'var(--versigo-space-2)' }}
                        title={`${t('policies.connector')}: ${l.connector.displayName}`}>
                        {l.connector.experimental ? t('policies.experimental') : t('policies.connector')}
                        {!l.connector.available ? t('policies.disabledSuffix') : ''}
                      </span>
                    )}
                    {targetUrl && (
                      <div>
                        <a href={targetUrl} target="_blank" rel="noopener noreferrer">
                          {t('policies.openPortal')}
                        </a>
                      </div>
                    )}
                    {l.accessHint && (
                      <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                        {l.accessHint}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 'var(--versigo-space-6)' }}>
        <CoverageSummarySection householdId="default" policyId={policyId} />
      </div>
    </AppShell>
  );
}
