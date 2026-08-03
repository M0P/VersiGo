'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../components/ui/app-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Loading } from '../../../../components/ui/loading';
import { Input, Select, FormField } from '../../../../components/ui/form-field';
import { NAV_SECTIONS } from '../../../../components/ui/nav-config';
import { formatCurrency, formatDate, useI18n } from '../../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

type AnnualCost = {
  policyId: string;
  year: number;
  annualGross: number;
  annualNet: number | null;
  calculationBasis: {
    entryId: string;
    frequency: string;
    grossAmount: number;
    validFrom: string;
    validTo: string | null;
  };
};

type CostEntry = {
  id: string;
  policyId: string;
  validFrom: string;
  validTo: string | null;
  grossAmount: number;
  netAmount: number | null;
  frequency: string;
  bookingSource: string | null;
  note: string | null;
  createdAt: string;
};

export default function PolicyCostsPage(): ReactElement {
  const params = useParams();
  const policyId = params.id as string;
  const { t, language } = useI18n();
  const [annual, setAnnual] = useState<AnnualCost | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newEntry, setNewEntry] = useState({
    validFrom: '',
    validTo: '',
    grossAmount: '',
    netAmount: '',
    frequency: 'MONTHLY',
    note: '',
  });

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs/annual`, { credentials: 'include' }),
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs`, { credentials: 'include' }),
    ])
      .then(([annualRes, entriesRes]) => {
        if (annualRes.status === 401 || entriesRes.status === 401) {
          window.location.href = '/login';
          return;
        }
        return Promise.all([
          annualRes.ok ? annualRes.json() : null,
          entriesRes.ok ? entriesRes.json() : [],
        ]).then(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ([annualData, entriesData]: [any, any]) => {
            if (annualData) setAnnual(annualData);
            setEntries(entriesData ?? []);
          },
        );
      })
      .catch(() => { setAnnual(null); setEntries([]); })
      .finally(() => setLoading(false));
  }, [policyId]);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const body: Record<string, unknown> = {
      validFrom: newEntry.validFrom,
      grossAmount: parseFloat(newEntry.grossAmount),
      frequency: newEntry.frequency,
    };
    if (newEntry.validTo) body.validTo = newEntry.validTo;
    if (newEntry.netAmount !== '') body.netAmount = parseFloat(newEntry.netAmount);
    if (newEntry.note) body.note = newEntry.note;

    fetch(`${API_BASE}/households/default/policies/${policyId}/costs`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        if (!res.ok) throw new Error(t('costs.createError'));
        return res.json();
      })
      .then(() => {
        window.location.reload();
      })
      .catch(() => alert(t('costs.createErrorDetail')))
      .finally(() => setSubmitting(false));
  }

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('costs.policyTitle')} />
        <Loading label={t('costs.policyLoading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('costs.policyTitle')}
        actions={<Link className="btn btn-secondary btn-sm" href={`/policies/${policyId}`}>{t('costs.backToPolicy')}</Link>}
      />

      <Card>
        <h2>{t('costs.annualOverview')}</h2>
        {annual ? (
          <dl className="detail-list">
            <dt>{t('costs.annualGross')}</dt><dd>{formatCurrency(annual.annualGross, language)}</dd>
            {annual.annualNet != null && <><dt>{t('costs.annualNet')}</dt><dd>{formatCurrency(annual.annualNet, language)}</dd></>}
            <dt>{t('costs.frequency')}</dt>
            <dd>{t(`costs.frequencies.${annual.calculationBasis.frequency}`) ?? annual.calculationBasis.frequency}</dd>
            <dt>{t('costs.calculationBasis')}</dt>
            <dd>{t('costs.since', { date: formatDate(annual.calculationBasis.validFrom, language) })}</dd>
          </dl>
        ) : (
          <p>{t('costs.noCostEntries')}</p>
        )}
      </Card>

      <Card>
        <h2>{t('costs.entriesTitle')}</h2>
        {entries.length === 0 && <p>{t('costs.noEntries')}</p>}
        {entries.length > 0 && (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('costs.validFrom')}</th>
                  <th>{t('costs.validTo')}</th>
                  <th>{t('costs.gross')}</th>
                  <th>{t('costs.net')}</th>
                  <th>{t('costs.frequency')}</th>
                  <th>{t('costs.note')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td data-label={t('costs.validFrom')}>{formatDate(e.validFrom, language)}</td>
                    <td data-label={t('costs.validTo')}>{e.validTo ? formatDate(e.validTo, language) : '-'}</td>
                    <td data-label={t('costs.gross')}>{formatCurrency(Number(e.grossAmount), language)}</td>
                    <td data-label={t('costs.net')}>{e.netAmount != null ? formatCurrency(Number(e.netAmount), language) : '-'}</td>
                    <td data-label={t('costs.frequency')}>{t(`costs.frequencies.${e.frequency}`) ?? e.frequency}</td>
                    <td data-label={t('costs.note')}>{e.note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2>{t('costs.newEntry')}</h2>
        <form onSubmit={handleCreate}>
          <FormField label={t('costs.validFrom')} required>
            <Input
              type="date"
              value={newEntry.validFrom}
              onChange={(e) => setNewEntry({ ...newEntry, validFrom: e.target.value })}
              required
            />
          </FormField>
          <FormField label={t('costs.validTo')}>
            <Input
              type="date"
              value={newEntry.validTo}
              onChange={(e) => setNewEntry({ ...newEntry, validTo: e.target.value })}
            />
          </FormField>
          <FormField label={t('costs.grossAmount')} required>
            <Input
              type="number"
              step="0.01"
              value={newEntry.grossAmount}
              onChange={(e) => setNewEntry({ ...newEntry, grossAmount: e.target.value })}
              required
            />
          </FormField>
          <FormField label={t('costs.netAmount')}>
            <Input
              type="number"
              step="0.01"
              value={newEntry.netAmount}
              onChange={(e) => setNewEntry({ ...newEntry, netAmount: e.target.value })}
            />
          </FormField>
          <FormField label={t('costs.frequency')}>
            <Select
              value={newEntry.frequency}
              onChange={(e) => setNewEntry({ ...newEntry, frequency: e.target.value })}
            >
              {FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {t(`costs.frequencies.${frequency}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('costs.note')}>
            <Input
              type="text"
              value={newEntry.note}
              onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })}
            />
          </FormField>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('costs.saving') : t('costs.save')}
          </Button>
        </form>
      </Card>
    </AppShell>
  );
}
