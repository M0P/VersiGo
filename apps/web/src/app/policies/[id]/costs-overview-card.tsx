'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/loading';
import { Alert } from '@/components/ui/alert';
import { useI18n, formatCurrency, formatDate } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type CostsOverview = {
  policyId: string;
  asOf: string;
  annualGross: number;
  annualNet: number | null;
  perFrequency: {
    MONTHLY: number;
    QUARTERLY: number;
    SEMI_ANNUAL: number;
    ANNUAL: number;
  };
  paidToDate: number;
  calculationBasis: {
    entryId: string;
    frequency: string;
    grossAmount: number;
    validFrom: string;
    validTo: string | null;
  };
};

/**
 * BugFix-05 (Befund 3): Kompakte Kostenuebersicht im Policy-Detail (Costs-Tab).
 * Laedt /costs/overview beim Mount und bei policyId-Wechsel (Abbruch-Guard,
 * 401-Redirect) – kein unendlicher Spinner, keine stale Daten.
 */
export default function CostsOverviewCard({ policyId }: { policyId: string }): ReactElement {
  const { t, language } = useI18n();
  const [overview, setOverview] = useState<CostsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/costs/overview`, {
          credentials: 'include',
        });
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setOverview(data);
        } else if (!cancelled) {
          setError(t('costs.unavailable'));
        }
      } catch {
        if (!cancelled) setError(t('costs.unavailable'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [policyId]);

  if (loading) {
    return (
      <Card>
        <h2>{t('policies.tabs.costs')}</h2>
        <div style={{ textAlign: 'center', padding: 'var(--versigo-space-8)' }}>
          <InlineSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
        <h2>{t('policies.tabs.costs')}</h2>
        <a href={`/policies/${policyId}/costs`}>
          <Button variant="secondary" size="sm">{t('costs.policyTitle')}</Button>
        </a>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {!error && !overview && <p>{t('costs.noCostEntries')}</p>}

      {!error && overview && (
        <>
          <dl className="detail-list">
            <dt>{t('costs.annualGross')}</dt>
            <dd>{formatCurrency(overview.annualGross, language)}</dd>
            {overview.annualNet != null && (
              <>
                <dt>{t('costs.annualNet')}</dt>
                <dd>{formatCurrency(overview.annualNet, language)}</dd>
              </>
            )}
            <dt>{t('costs.frequency')}</dt>
            <dd>{t(`costs.frequencies.${overview.calculationBasis.frequency}`) ?? overview.calculationBasis.frequency}</dd>
            <dt>{t('costs.perPeriod')}</dt>
            <dd>
              {t(`costs.frequencies.${overview.calculationBasis.frequency}`)}:{' '}
              {formatCurrency(overview.perFrequency[overview.calculationBasis.frequency as keyof typeof overview.perFrequency], language)}
            </dd>
            <dt>{t('costs.paidToDate')}</dt>
            <dd>
              {formatCurrency(overview.paidToDate, language)}
              <span className="text-xs text-muted"> ({t('costs.asOf', { date: formatDate(overview.asOf, language) })})</span>
            </dd>
          </dl>
          <p className="text-xs text-muted">
            {t('costs.calculationBasis')}: {t('costs.since', { date: formatDate(overview.calculationBasis.validFrom, language) })}
          </p>
        </>
      )}
    </Card>
  );
}
