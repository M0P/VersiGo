'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { formatCurrency, useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type SummaryPolicy = {
  id: string;
  name: string;
  type: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | null;
  annualGross: number | null;
  perFrequency: { MONTHLY: number; QUARTERLY: number; SEMI_ANNUAL: number; ANNUAL: number } | null;
  paidToDate: number;
};

type Summary = {
  totalAnnualGross: number;
  perType: Record<string, number>;
  policyCount: number;
  // BugFix-05 (Befund 7): Einzelne Versicherungen mit Kosten.
  policies: SummaryPolicy[];
};

export default function HouseholdCostsPage(): ReactElement {
  const { t, language } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/costs/summary`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('common.error'));
        return res.json();
      })
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('costs.title')} />
        <Loading label={t('costs.loading')} />
      </AppShell>
    );
  }

  if (!summary) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('costs.title')} />
        <Alert variant="warning">{t('costs.unavailable')}</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('costs.title')}
        description={t('costs.description')}
        actions={
          <a href="/policies">
            <Button variant="secondary" size="sm">{t('costs.goToPolicies')}</Button>
          </a>
        }
      />

      <div className="split-layout" style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <Card>
          <h3>{t('costs.totalAnnual')}</h3>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {formatCurrency(summary.totalAnnualGross, language)}
          </p>
        </Card>
        <Card>
          <h3>{t('costs.policyCount')}</h3>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {summary.policyCount}
          </p>
        </Card>
      </div>

      {/* BugFix-05 (Befund 7): Kosten je Versicherung einzeln. */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('costs.perPolicy')} />
        {summary.policies.length === 0 ? (
          <p className="text-muted">{t('costs.noData')}</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('costs.policy')}</th>
                  <th>{t('costs.type')}</th>
                  <th>{t('costs.annualCosts')}</th>
                  <th>{t('costs.perPeriod')}</th>
                  <th>{t('costs.paidToDate')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.policies.map((policy) => (
                  <tr key={policy.id}>
                    <td data-label={t('costs.policy')}>
                      <a className="link" href={`/policies/${policy.id}`}>{policy.name}</a>
                    </td>
                    <td data-label={t('costs.type')}>{t(`policies.types.${policy.type}`) ?? policy.type}</td>
                    <td data-label={t('costs.annualCosts')}>
                      {policy.annualGross !== null ? formatCurrency(policy.annualGross, language) : '—'}
                    </td>
                    <td data-label={t('costs.perPeriod')}>
                      {policy.frequency && policy.perFrequency ? (
                        <>
                          {t(`costs.frequencies.${policy.frequency}`)}:{' '}
                          {formatCurrency(policy.perFrequency[policy.frequency], language)}
                        </>
                      ) : '—'}
                    </td>
                    <td data-label={t('costs.paidToDate')}>
                      {policy.paidToDate > 0 ? formatCurrency(policy.paidToDate, language) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionHeader title={t('costs.byType')} />
        {Object.keys(summary.perType).length === 0 ? (
          <p className="text-muted">{t('costs.noData')}</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('costs.type')}</th>
                  <th>{t('costs.annualCosts')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.perType).map(([type, amount]) => (
                  <tr key={type}>
                    <td data-label={t('costs.type')}>{t(`policies.types.${type}`) ?? type}</td>
                    <td data-label={t('costs.annualCosts')}>{formatCurrency(amount, language)}</td>
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
