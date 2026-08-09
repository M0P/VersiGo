'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/loading';
import { Alert } from '@/components/ui/alert';
import { Input, Select, FormField } from '@/components/ui/form-field';
import { useI18n, formatCurrency, formatDate } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

// BugFix-08 (Q4): new entries are restricted to MONTHLY / QUARTERLY / ANNUAL;
// SEMI_ANNUAL remains available only for existing data in edit mode.
const NEW_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];
const ALL_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

// BugFix-08 (Q4): period table (incurred/expected) from GET .../costs/schedule.
type SchedulePeriod = {
  periodIndex: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: 'incurred' | 'expected';
  entryId: string | null;
};

type Schedule = {
  policyId: string;
  asOf: string;
  paidToDate: number;
  current: {
    annualGross: number;
    annualNet: number | null;
    perFrequency: { MONTHLY: number; QUARTERLY: number; ANNUAL: number };
    entryId: string;
    frequency: string;
    grossAmount: number;
    validFrom: string;
    validTo: string | null;
  } | null;
  periods: SchedulePeriod[];
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

/**
 * BugFix-08 (Q4): costs card in the policy detail view – the ONE central
 * place for managing a policy's costs (period table, "paid so far",
 * creating a cost increase from a date as well as editing/deleting – also
 * historical entries). The former separate page
 * /policies/[id]/costs no longer exists.
 */
export default function CostsOverviewCard({ policyId }: { policyId: string }): ReactElement {
  const { t, language } = useI18n();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Original entry during editing – used to compare which fields were
  // really changed (only those are sent), so that
  // exact timestamps (e.g. validTo 23:59:59.999) are preserved.
  const [editingOriginal, setEditingOriginal] = useState<CostEntry | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    validFrom: '', validTo: '', grossAmount: '', netAmount: '', frequency: 'MONTHLY', note: '',
  });
  const [newEntry, setNewEntry] = useState({
    validFrom: '', grossAmount: '', netAmount: '', frequency: 'MONTHLY', note: '',
  });
  const [actionError, setActionError] = useState<string | null>(null);

  // BugFix-05 (finding 8): seq token – no setState after await on stale
  // requests (e.g. after a policyId change). Every request increments the
  // token; a late response discards its updates.
  const requestSeq = useRef(0);

  const reload = () => {
    const seq = ++requestSeq.current;
    Promise.all([
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs/schedule`, { credentials: 'include' }),
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs`, { credentials: 'include' }),
    ])
      .then(([scheduleRes, entriesRes]) => {
        if (scheduleRes.status === 401 || entriesRes.status === 401) {
          window.location.href = '/login';
          return;
        }
        return Promise.all([
          scheduleRes.ok ? scheduleRes.json() : null,
          entriesRes.ok ? entriesRes.json() : [],
        ]).then(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ([scheduleData, entriesData]: [any, any]) => {
            if (seq !== requestSeq.current) return;
            // Always set (even null): a failed request must not keep
            // displaying the schedule of the previous policy
            // (BugFix-05, finding 8 – stale data after a policyId change).
            setSchedule(scheduleData);
            setEntries(entriesData ?? []);
          },
        );
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setSchedule(null);
        setEntries([]);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    reload();
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
        setNewEntry({ validFrom: '', grossAmount: '', netAmount: '', frequency: 'MONTHLY', note: '' });
        reload();
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
    setEditingOriginal(entry);
    setEditForm(toEditForm(entry));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingOriginal(null);
    setActionError(null);
  };

  function handleUpdate() {
    if (!editingId || !editingOriginal) return;
    const seq = ++requestSeq.current;
    setSubmitting(true);
    setActionError(null);
    // Only send fields that actually changed (BugFix-08 review 1):
    //  - validTo / netAmount / note can thereby be cleared again (null),
    //  - unchanged timestamps stay exactly preserved (no midnight shift).
    const body: Record<string, unknown> = {};
    if (editForm.validFrom !== editingOriginal.validFrom.slice(0, 10)) body.validFrom = editForm.validFrom;
    const originalValidTo = editingOriginal.validTo ? editingOriginal.validTo.slice(0, 10) : '';
    if (editForm.validTo !== originalValidTo) body.validTo = editForm.validTo === '' ? null : editForm.validTo;
    if (editForm.grossAmount !== String(Number(editingOriginal.grossAmount))) {
      body.grossAmount = parseFloat(editForm.grossAmount);
    }
    const originalNetAmount = editingOriginal.netAmount != null ? String(Number(editingOriginal.netAmount)) : '';
    if (editForm.netAmount !== originalNetAmount) body.netAmount = editForm.netAmount === '' ? null : parseFloat(editForm.netAmount);
    if (editForm.note !== (editingOriginal.note ?? '')) body.note = editForm.note === '' ? null : editForm.note;
    // BugFix-08: only send the frequency when it changed – thus
    // legacy entries (SEMI_ANNUAL) stay editable without a frequency
    // change (the DTO does not allow SEMI_ANNUAL for new values).
    if (editForm.frequency !== editingOriginal.frequency) body.frequency = editForm.frequency;

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
        setEditingOriginal(null);
        reload();
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
        if (editingId === id) { setEditingId(null); setEditingOriginal(null); }
        reload();
      }
    } catch {
      if (seq === requestSeq.current) setActionError(t('costs.deleteErrorDetail'));
    }
  };

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

  const current = schedule?.current ?? null;

  return (
    <>
      {actionError && (
        <div style={{ marginBottom: 'var(--versigo-space-4)' }}>
          <Alert variant="danger">{actionError}</Alert>
        </div>
      )}

      {!schedule && <Alert variant="warning">{t('costs.unavailable')}</Alert>}

      {/* Paid to date + current entry. */}
      {schedule && (
        <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--versigo-space-2)' }}>
            <h2>{t('costs.paidToDate')}</h2>
            <span className="text-xs text-muted">{t('costs.asOf', { date: formatDate(schedule.asOf, language) })}</span>
          </div>
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {formatCurrency(schedule.paidToDate, language)}
          </p>

          {current && (
            <dl className="detail-list" style={{ marginTop: 'var(--versigo-space-4)' }}>
              <dt>{t('costs.currentEntry')}</dt>
              <dd>
                {t(`costs.frequencies.${current.frequency}`) ?? current.frequency}: {formatCurrency(current.grossAmount, language)}
                {' '}
                <span className="text-xs text-muted">
                  ({t('costs.since', { date: formatDate(current.validFrom, language) })}
                  {current.validTo ? `, ${t('costs.until', { date: formatDate(current.validTo, language) })}` : ''})
                </span>
              </dd>
              <dt>{t('costs.annualGross')}</dt>
              <dd>{formatCurrency(current.annualGross, language)}</dd>
              {current.annualNet != null && (
                <>
                  <dt>{t('costs.annualNet')}</dt>
                  <dd>{formatCurrency(current.annualNet, language)}</dd>
                </>
              )}
            </dl>
          )}
        </Card>
      )}

      {/* BugFix-08 (Q4): Perioden-Tabelle incurred/expected. */}
      {schedule && (
        <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
          <h2>{t('costs.scheduleTitle')}</h2>
          <p className="form-hint">{t('costs.scheduleDescription')}</p>
          {schedule.periods.length === 0 ? (
            <p className="text-muted">{t('costs.noEntries')}</p>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('costs.period')}</th>
                    <th>{t('costs.periodStart')}</th>
                    <th>{t('costs.periodEnd')}</th>
                    <th>{t('costs.amount')}</th>
                    <th>{t('costs.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.periods.map((period) => (
                    <tr key={period.periodIndex}>
                      <td data-label={t('costs.period')}>{period.periodLabel}</td>
                      <td data-label={t('costs.periodStart')}>{formatDate(period.periodStart, language)}</td>
                      <td data-label={t('costs.periodEnd')}>{formatDate(period.periodEnd, language)}</td>
                      <td data-label={t('costs.amount')}>{formatCurrency(period.amount, language)}</td>
                      <td data-label={t('costs.status')}>
                        <span className={`badge ${period.status === 'incurred' ? 'badge-success' : 'badge-neutral'}`}>
                          {t(`costs.periodStatus.${period.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Cost entries (incl. editing/deleting historical entries). */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <h2>{t('costs.entriesTitle')}</h2>
        {entries.length === 0 && <p className="text-muted">{t('costs.noEntries')}</p>}
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
                          {/* Offer SEMI_ANNUAL only for legacy entries:
                              the DTO rejects SEMI_ANNUAL for new values. */}
                          {(editingOriginal?.frequency === 'SEMI_ANNUAL' ? ALL_FREQUENCIES : NEW_FREQUENCIES).map((frequency) => (
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

      {/* BugFix-08 (Q4): cost increase from a date – the previous
          entry is ended automatically. */}
      <Card>
        <h2>{t('costs.increaseTitle')}</h2>
        <p className="form-hint">{t('costs.increaseHint')}</p>
        <form onSubmit={handleCreate}>
          <FormField label={t('costs.validFrom')} required>
            <Input
              type="date"
              value={newEntry.validFrom}
              onChange={(e) => setNewEntry({ ...newEntry, validFrom: e.target.value })}
              required
            />
          </FormField>
          <FormField label={t('costs.grossAmount')} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={newEntry.grossAmount}
              onChange={(e) => setNewEntry({ ...newEntry, grossAmount: e.target.value })}
              required
            />
          </FormField>
          <FormField label={t('costs.netAmount')}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={newEntry.netAmount}
              onChange={(e) => setNewEntry({ ...newEntry, netAmount: e.target.value })}
            />
          </FormField>
          <FormField label={t('costs.frequency')}>
            <Select
              value={newEntry.frequency}
              onChange={(e) => setNewEntry({ ...newEntry, frequency: e.target.value })}
            >
              {NEW_FREQUENCIES.map((frequency) => (
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
            {submitting ? t('costs.saving') : t('costs.addEntry')}
          </Button>
        </form>
      </Card>
    </>
  );
}
