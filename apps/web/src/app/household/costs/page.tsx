'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { formatCurrency, formatDate, useI18n, type Language } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

// BugFix-08 (Q5): Neue Haushalts-Kostenuebersicht aus GET .../costs/summary.
type SummaryPolicy = {
  id: string;
  name: string;
  type: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | null;
  paidToDate: number;
  perMonth: number;
  perYear: number;
  entryCount: number;
};

type Summary = {
  asOf: string;
  totals: { paidToDate: number; perMonth: number; perYear: number };
  perYear: { year: number; amount: number }[];
  policyCount: number;
  policies: SummaryPolicy[];
};

/**
 * BugFix-08 (Q5): Historischer Graph – Kosten je Kalenderjahr als einfache
 * SVG-Balken (bewusst dependency-light, kein Chart-Framework noetig).
 * Basis: Summe der vollen Periodenbetraege aller begonnenen Perioden je Jahr.
 */
function PerYearChart({ data, language }: { data: { year: number; amount: number }[]; language: Language }): ReactElement {
  const { t } = useI18n();
  if (data.length === 0) {
    return <p className="text-muted">{t('costs.noHistory')}</p>;
  }

  const max = Math.max(...data.map((d) => d.amount), 0);
  const chartHeight = 180;
  const paddingTop = 18; // Platz fuer den Betrags-Wert ueber dem Balken
  const labelHeight = 22; // Platz fuer die Jahreszahl unter dem Balken
  const usableHeight = chartHeight - paddingTop - labelHeight;
  const slotWidth = 56;
  const barWidth = 28;
  const width = data.length * slotWidth;

  return (
    <svg
      viewBox={`0 0 ${width} ${chartHeight}`}
      role="img"
      aria-label={t('costs.historicTitle')}
      style={{ width: '100%', height: 'auto', maxWidth: width, display: 'block' }}
    >
      {data.map((d, i) => {
        const barHeight = max > 0 ? Math.max(2, (d.amount / max) * usableHeight) : 2;
        const x = i * slotWidth + (slotWidth - barWidth) / 2;
        const y = paddingTop + usableHeight - barHeight;
        return (
          <g key={d.year}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx="2"
              fill="var(--versigo-accent)"
            >
              <title>{`${d.year}: ${formatCurrency(d.amount, language)}`}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={y - 6}
              fontSize="10"
              textAnchor="middle"
              fill="var(--versigo-text)"
            >
              {formatCurrency(d.amount, language)}
            </text>
            <text
              x={x + barWidth / 2}
              y={chartHeight - 6}
              fontSize="11"
              fontWeight={600}
              textAnchor="middle"
              fill="var(--versigo-text)"
            >
              {d.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

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

      {/* BugFix-08 (Q5): Gesamtbetraege – was wurde ausgegeben (paidToDate),
          pro Monat und pro Jahr ueber alle Versicherungen. */}
      <div className="split-layout" style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <Card>
          <h3>{t('costs.paidToDate')}</h3>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {formatCurrency(summary.totals.paidToDate, language)}
          </p>
          <p className="text-xs text-muted" style={{ margin: 'var(--versigo-space-1) 0 0' }}>
            {t('costs.asOf', { date: formatDate(summary.asOf, language) })}
          </p>
        </Card>
        <Card>
          <h3>{t('costs.perMonth')}</h3>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {formatCurrency(summary.totals.perMonth, language)}
          </p>
        </Card>
        <Card>
          <h3>{t('costs.perYear')}</h3>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {formatCurrency(summary.totals.perYear, language)}
          </p>
        </Card>
        <Card>
          <h3>{t('costs.policyCount')}</h3>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {summary.policyCount}
          </p>
        </Card>
      </div>

      {/* BugFix-08 (Q5): Historischer Graph – Kosten pro Jahr. */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('costs.historicTitle')} />
        <p className="form-hint">{t('costs.historicDescription')}</p>
        <PerYearChart data={summary.perYear} language={language} />
      </Card>

      {/* BugFix-08 (Q5): Tiefste Ebene – je Versicherung die Kosten.
          paidToDate = "wie viel hat der Nutzer ausgegeben", dazu die
          projizierten Monats-/Jahresbetraege aus dem aktiven Eintrag. */}
      <Card>
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
                  <th>{t('costs.frequency')}</th>
                  <th>{t('costs.perMonth')}</th>
                  <th>{t('costs.perYear')}</th>
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
                    <td data-label={t('costs.frequency')}>
                      {policy.frequency ? t(`costs.frequencies.${policy.frequency}`) ?? policy.frequency : '—'}
                    </td>
                    <td data-label={t('costs.perMonth')}>
                      {policy.entryCount > 0 ? formatCurrency(policy.perMonth, language) : '—'}
                    </td>
                    <td data-label={t('costs.perYear')}>
                      {policy.entryCount > 0 ? formatCurrency(policy.perYear, language) : '—'}
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
    </AppShell>
  );
}
