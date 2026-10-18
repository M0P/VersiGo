'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/loading';
import { Alert } from '@/components/ui/alert';
import { Input, Select, FormField } from '@/components/ui/form-field';
import { useI18n, formatBasisAmount, formatCurrency, formatDateDmy } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { parseCostAmounts } from '@/lib/cost-amounts';
import type {
  CostEntryPrefill,
  CostPrefillNotice,
  CostSuggestionField,
} from '@/lib/cost-suggestion';

const API_BASE = getApiBaseUrl();

// BugFix-08 (Q4): new entries are restricted to MONTHLY / QUARTERLY / ANNUAL;
// SEMI_ANNUAL remains available only for existing data in edit mode.
const NEW_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];
const ALL_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

// BugFix-22: every amount is computed and displayed PER BASIS (gross/net).
// A missing basis stays null and renders as a dash – it is never replaced
// by the other basis.
type BasisAmounts = {
  gross: number | null;
  net: number | null;
};

// BugFix-08 (Q4): period table (incurred/expected) from GET .../costs/schedule.
type SchedulePeriod = {
  periodIndex: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  amount: BasisAmounts;
  status: 'incurred' | 'expected';
  entryId: string | null;
};

type Schedule = {
  policyId: string;
  asOf: string;
  anchor: string | null;
  frequency: string;
  paidToDate: BasisAmounts;
  current: {
    entryId: string;
    frequency: string;
    validFrom: string;
    validTo: string | null;
    amount: BasisAmounts;
    annual: BasisAmounts;
    perFrequency: { MONTHLY: BasisAmounts; QUARTERLY: BasisAmounts; ANNUAL: BasisAmounts };
  } | null;
  periods: SchedulePeriod[];
  perYear: { year: number; amount: BasisAmounts }[];
  entryCount: number;
};

type CostEntry = {
  id: string;
  policyId: string;
  validFrom: string;
  validTo: string | null;
  /** BugFix-22: gross is optional – a net-only entry is valid. */
  grossAmount: number | null;
  netAmount: number | null;
  frequency: string;
  bookingSource: string | null;
  note: string | null;
  /** AP-24 (§4.2): billing document this entry was derived from. */
  sourceDocumentId?: string | null;
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

type CreateForm = {
  validFrom: string;
  grossAmount: string;
  netAmount: string;
  frequency: string;
  bookingSource: string;
  note: string;
};

const EMPTY_CREATE_FORM: CreateForm = {
  validFrom: '',
  grossAmount: '',
  netAmount: '',
  frequency: 'MONTHLY',
  bookingSource: '',
  note: '',
};

function toEditForm(entry: CostEntry): EditForm {
  return {
    validFrom: entry.validFrom.slice(0, 10),
    validTo: entry.validTo ? entry.validTo.slice(0, 10) : '',
    grossAmount: entry.grossAmount != null ? String(Number(entry.grossAmount)) : '',
    netAmount: entry.netAmount != null ? String(Number(entry.netAmount)) : '',
    frequency: entry.frequency,
    note: entry.note ?? '',
  };
}

/**
 * BugFix-22: message key of a rejected amount input. The rule itself lives in
 * `parseCostAmounts` (and in the API service) – here it is only translated.
 */
function amountErrorKey(reason: 'missing' | 'invalid' | 'negative'): string {
  if (reason === 'missing') return 'costs.amountRequired';
  if (reason === 'negative') return 'costs.amountNegative';
  return 'costs.amountInvalid';
}

/**
 * BugFix-08 (Q4): costs card in the policy detail view – the ONE central
 * place for managing a policy's costs (period table, "paid so far",
 * creating a cost increase from a date as well as editing/deleting – also
 * historical entries). The former separate page
 * /policies/[id]/costs no longer exists.
 *
 * AP-24 (§4.2): an AI proposal for a billing document arrives as `prefill`
 * and only fills the create form – it is never saved automatically. The entry
 * is created through the regular endpoint, which also stores the document
 * reference. `onEntriesChanged` lets the sidebar refresh its "used" marking.
 */
export default function CostsOverviewCard({
  policyId,
  prefill = null,
  onEntriesChanged,
}: {
  policyId: string;
  prefill?: CostEntryPrefill | null;
  onEntriesChanged?: () => void;
}): ReactElement {
  const { t, language } = useI18n();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // AP-24 (§4.2): the last AI proposal. `prefillApplied` remembers its token
  // so one proposal is applied exactly once.
  const [prefillApplied, setPrefillApplied] = useState<string | null>(null);
  const [prefillSourceDocumentId, setPrefillSourceDocumentId] = useState<string | null>(null);
  const [prefillUnclearFields, setPrefillUnclearFields] = useState<CostSuggestionField[]>([]);
  const [prefillNotices, setPrefillNotices] = useState<CostPrefillNotice[]>([]);
  // Original entry during editing – used to compare which fields were
  // really changed (only those are sent), so that
  // exact timestamps (e.g. validTo 23:59:59.999) are preserved.
  const [editingOriginal, setEditingOriginal] = useState<CostEntry | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    validFrom: '', validTo: '', grossAmount: '', netAmount: '', frequency: 'MONTHLY', note: '',
  });
  const [newEntry, setNewEntry] = useState<CreateForm>(EMPTY_CREATE_FORM);
  // BugFix-22: "gross OR net is enough" – the field error of the amount inputs.
  const [newAmountError, setNewAmountError] = useState<string | null>(null);
  const [editAmountError, setEditAmountError] = useState<string | null>(null);
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

  /**
   * AP-24 (§4.2): applies an AI proposal to the create form.
   *
   * The proposal is identified by `prefill.token`, so it is applied exactly
   * once even though the effect re-runs on every render with the same
   * proposal. Nothing is sent to the server here – saving stays a deliberate
   * user action.
   */
  useEffect(() => {
    if (!prefill || prefill.token === prefillApplied) return;

    setPrefillApplied(prefill.token);
    setPrefillSourceDocumentId(prefill.sourceDocumentId);
    setPrefillUnclearFields(prefill.unclearFields);
    setPrefillNotices(prefill.notices);
    setNewAmountError(null);
    setActionError(null);
    setNewEntry((current) => ({
      ...current,
      validFrom: prefill.validFrom || current.validFrom,
      grossAmount: prefill.grossAmount,
      netAmount: prefill.netAmount,
      frequency: prefill.frequency ?? current.frequency,
      bookingSource: prefill.bookingSource,
      note: prefill.note,
    }));
  }, [prefill, prefillApplied]);

  /** Drops the proposal state (after a save or when the user dismisses it). */
  function clearPrefill(): void {
    setPrefillSourceDocumentId(null);
    setPrefillUnclearFields([]);
    setPrefillNotices([]);
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    // BugFix-22: the gross amount is no longer mandatory – one of gross/net
    // is enough. The rule is validated before the request so the user gets
    // the message at the field instead of a generic server error.
    const amounts = parseCostAmounts(newEntry.grossAmount, newEntry.netAmount);
    if (!amounts.ok) {
      setNewAmountError(t(amountErrorKey(amounts.reason)));
      return;
    }
    setNewAmountError(null);
    const seq = ++requestSeq.current;
    setSubmitting(true);
    setActionError(null);
    const body: Record<string, unknown> = {
      validFrom: newEntry.validFrom,
      frequency: newEntry.frequency,
    };
    if (amounts.grossAmount !== undefined) body.grossAmount = amounts.grossAmount;
    if (amounts.netAmount !== undefined) body.netAmount = amounts.netAmount;
    if (newEntry.note) body.note = newEntry.note;
    if (newEntry.bookingSource) body.bookingSource = newEntry.bookingSource;
    // AP-24 (§4.2): the reference to the billing document the values came
    // from. Only sent when the entry was actually created from a proposal.
    if (prefillSourceDocumentId) body.sourceDocumentId = prefillSourceDocumentId;

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
        setNewEntry(EMPTY_CREATE_FORM);
        // Successful save also clears any previous amount-validation error.
        setNewAmountError(null);
        // The proposal has been used – drop its state.
        clearPrefill();
        // reload() increments requestSeq itself – the .finally below must
        // therefore NOT gate setSubmitting(false) on the captured seq
        // (BugFix-22: after a successful save the button stayed blocked).
        reload();
        onEntriesChanged?.();
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setActionError(t('costs.createErrorDetail'));
      })
      .finally(() => {
        // The submit lock belongs to this promise chain only: exactly one
        // submit can be active at a time (both buttons are disabled while
        // `submitting` is true), so it is cleared unconditionally – like
        // every other form in the codebase. Only data writes above remain
        // seq-guarded.
        setSubmitting(false);
      });
  }

  const handleEdit = (entry: CostEntry) => {
    setActionError(null);
    setEditAmountError(null);
    setEditingId(entry.id);
    setEditingOriginal(entry);
    setEditForm(toEditForm(entry));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingOriginal(null);
    setActionError(null);
    setEditAmountError(null);
  };

  function handleUpdate() {
    if (!editingId || !editingOriginal) return;
    // BugFix-22: the same rule as on create – at least one of gross/net must
    // remain, and both may be empty as long as the other one is filled in.
    const amounts = parseCostAmounts(editForm.grossAmount, editForm.netAmount);
    if (!amounts.ok) {
      setEditAmountError(t(amountErrorKey(amounts.reason)));
      return;
    }
    setEditAmountError(null);
    const seq = ++requestSeq.current;
    setSubmitting(true);
    setActionError(null);
    // Only send fields that actually changed (BugFix-08 review 1):
    //  - validTo / grossAmount / netAmount / note can thereby be cleared again
    //    (null),
    //  - unchanged timestamps stay exactly preserved (no midnight shift).
    const body: Record<string, unknown> = {};
    if (editForm.validFrom !== editingOriginal.validFrom.slice(0, 10)) body.validFrom = editForm.validFrom;
    const originalValidTo = editingOriginal.validTo ? editingOriginal.validTo.slice(0, 10) : '';
    if (editForm.validTo !== originalValidTo) body.validTo = editForm.validTo === '' ? null : editForm.validTo;
    const originalGrossAmount = editingOriginal.grossAmount != null ? String(Number(editingOriginal.grossAmount)) : '';
    if (editForm.grossAmount !== originalGrossAmount) {
      body.grossAmount = amounts.grossAmount === undefined ? null : amounts.grossAmount;
    }
    const originalNetAmount = editingOriginal.netAmount != null ? String(Number(editingOriginal.netAmount)) : '';
    if (editForm.netAmount !== originalNetAmount) body.netAmount = amounts.netAmount === undefined ? null : amounts.netAmount;
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
        // AP-24 (§4.2): the sidebar marks documents referenced by a cost
        // entry and refreshes after every successful write.
        onEntriesChanged?.();
        // reload() increments requestSeq – see handleCreate: the .finally
        // below must not depend on the captured seq (BugFix-22).
        reload();
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setActionError(t('costs.updateErrorDetail'));
      })
      .finally(() => {
        // Unconditional UI-lock reset (BugFix-22); data writes stay
        // seq-guarded above.
        setSubmitting(false);
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
        onEntriesChanged?.();
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
            <span className="text-xs text-muted">{t('costs.asOf', { date: formatDateDmy(schedule.asOf) })}</span>
          </div>
          {/* BugFix-22: every sum names its basis (brutto/netto); a missing
              basis is shown as a dash, never borrowed from the other basis. */}
          <p style={{ fontSize: 'var(--versigo-font-size-3xl)', fontWeight: 'var(--versigo-font-weight-bold)', color: 'var(--versigo-accent)', margin: 0 }}>
            {t('costs.basisGross')}: {formatBasisAmount(schedule.paidToDate.gross, language)}
            {' · '}
            {t('costs.basisNet')}: {formatBasisAmount(schedule.paidToDate.net, language)}
          </p>

          {current && (
            <dl className="detail-list" style={{ marginTop: 'var(--versigo-space-4)' }}>
              <dt>{t('costs.currentEntry')}</dt>
              <dd>
                {t(`costs.frequencies.${current.frequency}`) ?? current.frequency}:{' '}
                {t('costs.basisGross')}: {formatBasisAmount(current.amount.gross, language)}
                {' / '}
                {t('costs.basisNet')}: {formatBasisAmount(current.amount.net, language)}
                {' '}
                <span className="text-xs text-muted">
                  ({t('costs.since', { date: formatDateDmy(current.validFrom) })}
                  {current.validTo ? `, ${t('costs.until', { date: formatDateDmy(current.validTo) })}` : ''})
                </span>
              </dd>
              <dt>{t('costs.annualGross')}</dt>
              <dd>{formatBasisAmount(current.annual.gross, language)}</dd>
              <dt>{t('costs.annualNet')}</dt>
              <dd>{formatBasisAmount(current.annual.net, language)}</dd>
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
                    {/* BugFix-22: one column per basis – no combined value. */}
                    <th>{t('costs.amountGross')}</th>
                    <th>{t('costs.amountNet')}</th>
                    <th>{t('costs.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.periods.map((period) => (
                    <tr key={period.periodIndex}>
                      <td data-label={t('costs.period')}>{period.periodLabel}</td>
                      <td data-label={t('costs.periodStart')}>{formatDateDmy(period.periodStart)}</td>
                      <td data-label={t('costs.periodEnd')}>{formatDateDmy(period.periodEnd)}</td>
                      <td data-label={t('costs.amountGross')}>{formatBasisAmount(period.amount.gross, language)}</td>
                      <td data-label={t('costs.amountNet')}>{formatBasisAmount(period.amount.net, language)}</td>
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
                        {/* BugFix-22: gross is optional – an empty gross
                            amount is allowed while net is filled in (the
                            "at least one" rule is checked on save). */}
                        <Input type="number" step="0.01" min="0" value={editForm.grossAmount} onChange={(ev) => { setEditAmountError(null); setEditForm({ ...editForm, grossAmount: ev.target.value }); }} />
                      </td>
                      <td data-label={t('costs.net')}>
                        <Input type="number" step="0.01" min="0" value={editForm.netAmount} onChange={(ev) => { setEditAmountError(null); setEditForm({ ...editForm, netAmount: ev.target.value }); }} />
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
                      <td data-label={t('costs.validFrom')}>{formatDateDmy(e.validFrom)}</td>
                      <td data-label={t('costs.validTo')}>{e.validTo ? formatDateDmy(e.validTo) : '—'}</td>
                      <td data-label={t('costs.gross')}>{e.grossAmount != null ? formatCurrency(Number(e.grossAmount), language) : '—'}</td>
                      <td data-label={t('costs.net')}>{e.netAmount != null ? formatCurrency(Number(e.netAmount), language) : '—'}</td>
                      <td data-label={t('costs.frequency')}>{t(`costs.frequencies.${e.frequency}`) ?? e.frequency}</td>
                      <td data-label={t('costs.note')}>
                        {/* AP-24 (§4.2): the entry names its source document. */}
                        {e.sourceDocumentId && (
                          <>
                            <span className="badge badge-neutral" title={t('costs.sourceDocumentHint')}>
                              {t('costs.sourceDocumentBadge')}
                            </span>{' '}
                          </>
                        )}
                        {e.note ?? '—'}
                      </td>
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
        {/* BugFix-22: message of the "at least one of gross/net" rule while
            editing an entry. */}
        {editAmountError && (
          <div style={{ marginTop: 'var(--versigo-space-3)' }}>
            <Alert variant="danger">{editAmountError}</Alert>
          </div>
        )}
      </Card>

      {/* BugFix-08 (Q4): cost increase from a date – the previous
          entry is ended automatically. */}
      <Card>
        <h2>{t('costs.increaseTitle')}</h2>
        <p className="form-hint">{t('costs.increaseHint')}</p>
        {/* BugFix-22: gross and net are both optional – one of them is enough. */}
        <p className="form-hint">{t('costs.amountHint')}</p>
        {/* AP-24 (§4.2): the values below come from an AI proposal, not from
            an automatic save. The user reviews and confirms them. */}
        {prefillSourceDocumentId && (
          <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
            <Alert variant="info">
              {t('costs.aiPrefillNotice')}
              {prefillNotices.length > 0 && (
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
                  {prefillNotices.map((notice, index) => (
                    <li key={`${notice.key}-${index}`}>{t(notice.key, notice.params)}</li>
                  ))}
                </ul>
              )}
            </Alert>
          </div>
        )}
        {newAmountError && (
          <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
            <Alert variant="danger">{newAmountError}</Alert>
          </div>
        )}
        <form onSubmit={handleCreate}>
          <FormField
            label={t('costs.validFrom')}
            required
            hint={prefillUnclearFields.includes('validFrom') ? t('costs.fieldUnclear') : undefined}
          >
            <Input
              type="date"
              value={newEntry.validFrom}
              onChange={(e) => setNewEntry({ ...newEntry, validFrom: e.target.value })}
              required
            />
          </FormField>
          <FormField
            label={`${t('costs.grossAmount')} (${t('common.optional')})`}
            hint={prefillUnclearFields.includes('amount') ? t('costs.fieldUnclear') : undefined}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={newEntry.grossAmount}
              onChange={(e) => { setNewAmountError(null); setNewEntry({ ...newEntry, grossAmount: e.target.value }); }}
            />
          </FormField>
          <FormField label={`${t('costs.netAmount')} (${t('common.optional')})`}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={newEntry.netAmount}
              onChange={(e) => { setNewAmountError(null); setNewEntry({ ...newEntry, netAmount: e.target.value }); }}
            />
          </FormField>
          <FormField
            label={t('costs.frequency')}
            hint={prefillUnclearFields.includes('frequency') ? t('costs.fieldUnclear') : undefined}
          >
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
          <FormField
            label={`${t('costs.bookingSource')} (${t('common.optional')})`}
            hint={prefillUnclearFields.includes('bookingSource') ? t('costs.fieldUnclear') : undefined}
          >
            <Input
              type="text"
              value={newEntry.bookingSource}
              onChange={(e) => setNewEntry({ ...newEntry, bookingSource: e.target.value })}
            />
          </FormField>
          <FormField
            label={t('costs.note')}
            hint={prefillUnclearFields.includes('description') ? t('costs.fieldUnclear') : undefined}
          >
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
