'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { formatCurrency, formatDate, useI18n } from '../../../i18n';
import CoverageSummarySection from './coverage-summary-section';
import CoveredPersonsTab from './covered-persons-tab';
import DocumentsTab from './documents-tab';
import PortalLinksTab from './portal-links-tab';
import CostsOverviewCard from './costs-overview-card';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { normalizePortalUrl } from '@/lib/portal-url';

const API_BASE = getApiBaseUrl();

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
  premiumCurrency: string | null;
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

type TabKey = 'masterData' | 'coveredPersons' | 'documents' | 'portalLinks' | 'coverage' | 'costs';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'masterData', label: 'policies.tabs.masterData' },
  { key: 'coveredPersons', label: 'policies.tabs.coveredPersons' },
  { key: 'documents', label: 'policies.tabs.documents' },
  { key: 'portalLinks', label: 'policies.tabs.portalLinks' },
  { key: 'coverage', label: 'policies.tabs.coverage' },
  { key: 'costs', label: 'policies.tabs.costs' },
];

export default function PolicyDetailPage(): ReactElement {
  const params = useParams();
  const policyId = params.id as string;
  const { t, language } = useI18n();
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('masterData');

  useEffect(() => {
    // BugFix-05 (Befund 8): Beim policyId-Wechsel zuruecksetzen und in-flight
    // Requests der vorherigen Versicherung verwerfen – weder der Header noch
    // die Masterdaten von A duerfen transient unter /policies/B erscheinen.
    // Der cancelled-Flag (Cleanup) verhindert, dass eine langsame A-Antwort
    // die bereits geladene B-Ansicht ueberschreibt.
    let cancelled = false;
    setPolicy(null);
    setLoading(true);
    fetch(`${API_BASE}/households/default/policies/${policyId}`, { credentials: 'include' })
      .then((res) => {
        if (cancelled) return Promise.resolve(null);
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('policies.notFound'));
        return res.json();
      })
      .then((data) => { if (!cancelled && data) setPolicy(data); })
      .catch(() => { if (!cancelled) setPolicy(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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

  const renderTabContent = () => {
    switch (activeTab) {
      case 'masterData':
        return (
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

              {policy.insurerPortalUrl && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.insurerPortalUrl')}</dt>
                  <dd style={{ margin: 0 }}>
                    <a href={normalizePortalUrl(policy.insurerPortalUrl)} target="_blank" rel="noopener noreferrer">{policy.insurerPortalUrl}</a>
                  </dd>
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

              {policy.renewalDate && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.renewalDate')}</dt>
                  <dd style={{ margin: 0 }}>{formatDate(policy.renewalDate, language)}</dd>
                </>
              )}

              {policy.noticePeriod != null && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.noticePeriod')}</dt>
                  <dd style={{ margin: 0 }}>{policy.noticePeriod} {t('common.days')}</dd>
                </>
              )}

              {policy.paymentFrequency && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.paymentFrequency')}</dt>
                  <dd style={{ margin: 0 }}>{t(`costs.frequencies.${policy.paymentFrequency}`) ?? policy.paymentFrequency}</dd>
                </>
              )}

              {policy.premiumAmount != null && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.premium')}</dt>
                  <dd style={{ margin: 0 }}>{formatCurrency(policy.premiumAmount, language)} {policy.premiumCurrency ?? 'EUR'}</dd>
                </>
              )}

              {policy.deductibleAmount != null && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.deductibleAmount')}</dt>
                  <dd style={{ margin: 0 }}>{formatCurrency(policy.deductibleAmount, language)} {policy.premiumCurrency ?? 'EUR'}</dd>
                </>
              )}

              {policy.coverageSummaryShort && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.coverageSummaryShort')}</dt>
                  <dd style={{ margin: 0 }}>{policy.coverageSummaryShort}</dd>
                </>
              )}

              {policy.source && (
                <>
                  <dt className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>{t('policies.source')}</dt>
                  <dd style={{ margin: 0 }}>{t(`policies.sources.${policy.source}`) ?? policy.source}</dd>
                </>
              )}
            </dl>
          </Card>
        );

      case 'coveredPersons':
        return <CoveredPersonsTab policyId={policyId} />;

      case 'documents':
        return <DocumentsTab policyId={policyId} />;

      case 'portalLinks':
        return <PortalLinksTab policyId={policyId} />;

      case 'coverage':
        return <CoverageSummarySection householdId="default" policyId={policyId} />;

      case 'costs':
        // BugFix-05 (Befund 3): Eingebettete Kostenuebersicht statt Link-Card.
        return <CostsOverviewCard policyId={policyId} />;

      default:
        return null;
    }
  };

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={policy.insurerName}
        description={`${t(`policies.types.${policy.type}`) ?? policy.type} • ${t(`policies.statuses.${policy.status}`) ?? policy.status}`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
            <a href={`/policies/${policyId}/edit`}>
              <Button variant="secondary" size="sm">{t('common.edit')}</Button>
            </a>
            <a href="/policies">
              <Button variant="secondary" size="sm">{t('policies.backToOverview')}</Button>
            </a>
          </div>
        }
      />

      {/* Tab Navigation */}
      <div style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <nav className="tab-nav" style={{ display: 'flex', gap: 'var(--versigo-space-1)', borderBottom: '2px solid var(--versigo-border)', overflowX: 'auto' }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: 'var(--versigo-space-3) var(--versigo-space-4)',
                border: 'none',
                background: activeTab === tab.key ? 'var(--versigo-accent)' : 'transparent',
                color: activeTab === tab.key ? 'white' : 'var(--versigo-text)',
                borderBottom: activeTab === tab.key ? '2px solid var(--versigo-accent)' : '2px solid transparent',
                marginBottom: '-2px',
                cursor: 'pointer',
                fontWeight: activeTab === tab.key ? 600 : 400,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
              }}
            >
              {t(tab.label)}
            </button>
          ))}
        </nav>
      </div>

      {renderTabContent()}
    </AppShell>
  );
}
