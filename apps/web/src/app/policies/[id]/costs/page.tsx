'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../components/ui/app-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Loading } from '../../../../components/ui/loading';
import { Alert } from '../../../../components/ui/alert';
import { Input, Select, FormField } from '../../../../components/ui/form-field';
import { NAV_SECTIONS } from '../../../../components/ui/nav-config';
import { formatCurrency, formatDate, useI18n } from '../../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

type AnnualCost = {
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

// BugFix-06 (Teil 3): Zahlungshistorie je Abrechnungszeitraum
// (GET .../costs/paid-history, Versicherungsbeginn bis heute).
type PaidHistoryPeriod = {
  periodIndex: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  dueAmount: number;
  paidAmount: number;
  status: 'paid' | 'current' | 'future';
};

type PaidHistory = {
  policyId: string;
  frequency: string;
  asOf: string;
  periods: PaidHistoryPeriod[];
};

type EditForm = {
  validFrom: string;
  validTo: string;
  grossAmount: string;
  netAmount: string;
  frequency: string;
  note: string;
};

function toEditForm(entry: CostEntry): EditForm {
  return {
    validFrom: entry.validFrom.slice(0, 10),
    validTo: entry.validTo ? entry.validTo.slice(0, 10) : '',
    grossAmount: String(Number(entry.grossAmount)),
    netAmount: entry.netAmount != null ? String(Number(entry.netAmount)) : '',
    frequency: entry.frequency,
    note: entry.note ?? '',
  };
}

export default function PolicyCostsPage(): ReactElement {
  const params = useParams();
  const policyId = params.id as string;
  const { t, language } = useI18n();
  const [annual, setAnnual] = useState<AnnualCost | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [history, setHistory] = useState<PaidHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(toEditForm({
    id: '', policyId: '', validFrom: '', validTo: null, grossAmount: 0, netAmount: null,
    frequency: 'MONTHLY', bookingSource: null, note: null, createdAt: '',
  }));
  const [actionError, setActionError] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState({
    validFrom: '',
    validTo: '',
    grossAmount: '',
    netAmount: '',
    frequency: 'MONTHLY',
    note: '',
  });

  // BugFix-05 (Befund 8): Seq-Token – kein setState nach await auf veraltete
  // Requests (z. B. nach policyId-Wechsel). Jeder Request inkrementiert das
  // Token; ein spaeter eintreffender Response verwirft seine Updates.
  const requestSeq = useRef(0);

  const reloadData = () => {
    const seq = ++requestSeq.current;
    Promise.all([
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs/overview`, { credentials: 'include' }),
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs`, { credentials: 'include' }),
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs/paid-history`, { credentials: 'include' }),
    ])
      .then(([annualRes, entriesRes, historyRes]) => {
        if (annualRes.status === 401 || entriesRes.status === 401 || historyRes.status === 401) {
          window.location.href = '/login';
          return;
        }
        return Promise.all([
          annualRes.ok ? annualRes.json() : null,
          entriesRes.ok ? entriesRes.json() : [],
          historyRes.ok ? historyRes.json() : null,
        ]).then(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ([annualData, entriesData, historyData]: [any, any, any]) => {
            if (seq !== requestSeq.current) return;
            if (annualData) setAnnual(annualData);
            setEntries(entriesData ?? []);
            setHistory(historyData ?? null);
          },
        );
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setAnnual(null);
        setEntries([]);
        setHistory(null);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    reloadData();
  }, [policyId]);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const seq = ++requestSeq.current;
    setSubmitting(true);
    setActionError(null);
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
        if (seq !== requestSeq.current) return;
        setNewEntry({ validFrom: '', validTo: '', grossAmount: '', netAmount: '', frequency: 'MONTHLY', note: '' });
        reloadData();
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setActionError(t('costs.createErrorDetail'));
      })
      .finally(() => {
        if (seq === requestSeq.current) setSubmitting(false);
      });
  }

  const handleEdit = (entry: CostEntry) => {
    setActionError(null);
    setEditingId(entry.id);
    setEditForm(toEditForm(entry));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setActionError(null);
  };

  function handleUpdate() {
    if (!editingId) return;
    const seq = ++requestSeq.current;
    setSubmitting(true);
    setActionError(null);
    const body: Record<string, unknown> = {
      validFrom: editForm.validFrom,
      grossAmount: parseFloat(editForm.grossAmount),
      frequency: editForm.frequency,
    };
    if (editForm.validTo) body.validTo = editForm.validTo;
    if (editForm.netAmount !== '') body.netAmount = parseFloat(editForm.netAmount);
    if (editForm.note) body.note = editForm.note;

    fetch(`${API_BASE}/households/default/policies/${policyId}/costs/${editingId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        if (!res.ok) throw new Error(t('costs.updateError'));
        return res.json();
      })
      .then(() => {
        if (seq !== requestSeq.current) return;
        setEditingId(null);
        reloadData();
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setActionError(t('costs.updateErrorDetail'));
      })
      .finally(() => {
        if (seq === requestSeq.current) setSubmitting(false);
      });
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('costs.confirmDeleteEntry'))) return;
    const seq = ++requestSeq.current;
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/costs/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error(t('costs.delete'));
      if (seq === requestSeq.current) {
        if (editingId === id) setEditingId(null);
        reloadData();
      }
    } catch {
      if (seq === requestSeq.current) setActionError(t('costs.deleteErrorDetail'));
    }
  };

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

      {actionError && (
        <div style={{ marginBottom: 'var(--versigo-space-4)' }}>
          <Alert variant="danger">{actionError}</Alert>
        </div>
      )}

      <Card>
        <h2>{t('costs.annualOverview')}</h2>
        {annual ? (
          <>
            <dl className="detail-list">
              <dt>{t('costs.annualGross')}</dt><dd>{formatCurrency(annual.annualGross, language)}</dd>
              {annual.annualNet != null && <><dt>{t('costs.annualNet')}</dt><dd>{formatCurrency(annual.annualNet, language)}</dd></>}
              <dt>{t('costs.frequency')}</dt>
              <dd>{t(`costs.frequencies.${annual.calculationBasis.frequency}`) ?? annual.calculationBasis.frequency}</dd>
              <dt>{t('costs.calculationBasis')}</dt>
              <dd>{t('costs.since', { date: formatDate(annual.calculationBasis.validFrom, language) })}</dd>
            </dl>

            {/* BugFix-05 (Befund 3): bisher gezahlt + Periodenbetraege. */}
            <dl className="detail-list">
              <dt>{t('costs.paidToDate')}</dt>
              <dd>
                {formatCurrency(annual.paidToDate, language)}
                <span className="text-xs text-muted"> ({t('costs.asOf', { date: formatDate(annual.asOf, language) })})</span>
              </dd>
            </dl>
            <dl className="detail-list">
              <dt>{t('costs.perPeriod')}</dt>
              <dd>
                <span>{t('costs.perMonth')}: {formatCurrency(annual.perFrequency.MONTHLY, language)}</span>
                {' · '}
                <span>{t('costs.perQuarter')}: {formatCurrency(annual.perFrequency.QUARTERLY, language)}</span>
                {' · '}
                <span>{t('costs.perHalfYear')}: {formatCurrency(annual.perFrequency.SEMI_ANNUAL, language)}</span>
                {' · '}
                <span>{t('costs.perYear')}: {formatCurrency(annual.perFrequency.ANNUAL, language)}</span>
              </dd>
            </dl>
          </>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) =>
                  editingId === e.id ? (
                    // BugFix-06 (Teil 3): Inline-Bearbeitung einer bestehenden
                    // Kostenposition (PATCH /costs/:entryId).
                    <tr key={e.id}>
                      <td data-label={t('costs.validFrom')}>
                        <Input type="date" value={editForm.validFrom} onChange={(ev) => setEditForm({ ...editForm, validFrom: ev.target.value })} />
                      </td>
                      <td data-label={t('costs.validTo')}>
                        <Input type="date" value={editForm.validTo} onChange={(ev) => setEditForm({ ...editForm, validTo: ev.target.value })} />
                      </td>
                      <td data-label={t('costs.gross')}>
                        <Input type="number" step="0.01" value={editForm.grossAmount} onChange={(ev) => setEditForm({ ...editForm, grossAmount: ev.target.value })} />
                      </td>
                      <td data-label={t('costs.net')}>
                        <Input type="number" step="0.01" value={editForm.netAmount} onChange={(ev) => setEditForm({ ...editForm, netAmount: ev.target.value })} />
                      </td>
                      <td data-label={t('costs.frequency')}>
                        <Select value={editForm.frequency} onChange={(ev) => setEditForm({ ...editForm, frequency: ev.target.value })}>
                          {FREQUENCIES.map((frequency) => (
                            <option key={frequency} value={frequency}>{t(`costs.frequencies.${frequency}`)}</option>
                          ))}
                        </Select>
                      </td>
                      <td data-label={t('costs.note')}>
                        <Input type="text" value={editForm.note} onChange={(ev) => setEditForm({ ...editForm, note: ev.target.value })} />
                      </td>
                      <td>
                        <Button size="sm" onClick={handleUpdate} disabled={submitting}>
                          {submitting ? t('costs.saving') : t('costs.save')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={cancelEdit}>
                          {t('costs.cancel')}
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id}>
                      <td data-label={t('costs.validFrom')}>{formatDate(e.validFrom, language)}</td>
                      <td data-label={t('costs.validTo')}>{e.validTo ? formatDate(e.validTo, language) : '-'}</td>
                      <td data-label={t('costs.gross')}>{formatCurrency(Number(e.grossAmount), language)}</td>
                      <td data-label={t('costs.net')}>{e.netAmount != null ? formatCurrency(Number(e.netAmount), language) : '-'}</td>
                      <td data-label={t('costs.frequency')}>{t(`costs.frequencies.${e.frequency}`) ?? e.frequency}</td>
                      <td data-label={t('costs.note')}>{e.note ?? '-'}</td>
                      <td>
                        <Button size="sm" variant="secondary" onClick={() => handleEdit(e)}>
                          {t('costs.edit')}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void handleDelete(e.id)}>
                          {t('costs.delete')}
                        </Button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* BugFix-06 (Teil 3): Zahlungshistorie je Abrechnungszeitraum. */}
      {history && history.periods.length > 0 && (
        <Card>
          <h2>{t('costs.paidHistoryTitle')}</h2>
          <p className="form-hint">{t('costs.paidHistoryDescription')}</p>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('costs.period')}</th>
                  <th>{t('costs.dueAmount')}</th>
                  <th>{t('costs.paidAmount')}</th>
                  <th>{t('costs.deviation')}</th>
                  <th>{t('costs.status')}</th>
                </tr>
              </thead>
              <tbody>
                {history.periods.map((period) => (
                  <tr key={period.periodIndex}>
                    <td data-label={t('costs.period')}>
                      {period.periodLabel}
                      <span className="text-xs text-muted"> ({formatDate(period.periodStart, language)} – {formatDate(period.periodEnd, language)})</span>
                    </td>
                    <td data-label={t('costs.dueAmount')}>{formatCurrency(period.dueAmount, language)}</td>
                    <td data-label={t('costs.paidAmount')}>{formatCurrency(period.paidAmount, language)}</td>
                    <td data-label={t('costs.deviation')}>{formatCurrency(period.dueAmount - period.paidAmount, language)}</td>
                    <td data-label={t('costs.status')}>{t(`costs.historyStatus.${period.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
