'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Input, Select, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import {
  COVERED_SUBJECT_TYPES,
  DEFAULT_COVERED_SUBJECT_TYPE,
  coveredSubjectIcon,
  coveredSubjectLabelKey,
  isBirthDateRelevant,
  normalizeCoveredSubjectType,
  type CoveredSubjectType,
} from '@/lib/covered-subject';

const API_BASE = getApiBaseUrl();

/**
 * BugFix-22: an insured subject is a person or an object (car, house, …). The
 * API field `subjectType` is optional in responses for backward compatibility,
 * so it is normalised on read (missing → PERSON).
 */
type CoveredSubject = {
  id: string;
  personName: string;
  relationType: string | null;
  birthDate: string | null;
  subjectType?: string | null;
};

type CoveredSubjectForm = {
  personName: string;
  subjectType: CoveredSubjectType;
  relationType: string;
  birthDate: string;
};

const EMPTY_FORM: CoveredSubjectForm = {
  personName: '',
  subjectType: DEFAULT_COVERED_SUBJECT_TYPE,
  relationType: '',
  birthDate: '',
};

/**
 * BugFix-22: the kind of a subject as a compact icon with an accessible name.
 */
function CoveredSubjectIcon({ subjectType }: { subjectType?: string | null }): ReactElement {
  const { t } = useI18n();
  const kind = normalizeCoveredSubjectType(subjectType);
  const label = t(coveredSubjectLabelKey(kind));

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--versigo-text-muted)' }}
    >
      <Icon name={coveredSubjectIcon(kind)} size={18} />
    </span>
  );
}

export default function CoveredPersonsTab({ policyId }: { policyId: string }): ReactElement {
  const { t } = useI18n();
  const [persons, setPersons] = useState<CoveredSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CoveredSubjectForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Shared loading logic for the mount effect and handler reloads. A
  // monotonically increasing counter (`requestSeq`) invalidates in-flight
  // requests on every new load as well as on unmount/policyId change: only
  // the newest request may write state – also after submits/deletes that
  // still arrive after a policyId change (BugFix-05, finding 8: no
  // foreign-data leak from policy A under B).
  const requestSeq = useRef(0);

  const reloadPersons = async () => {
    const seq = ++requestSeq.current;
    // BugFix-05 (finding 8): reset state so a policyId change does not
    // display data from the previous policy.
    setPersons([]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}`, { credentials: 'include' });
      if (seq !== requestSeq.current) return;
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.ok) {
        const data = await res.json();
        if (seq === requestSeq.current) setPersons(data.coveredPersons || []);
      } else if (seq === requestSeq.current) {
        setError(t('policies.noPersonsBody'));
      }
    } catch {
      if (seq === requestSeq.current) setError(t('policies.noPersonsBody'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  // BugFix-05 (finding 4): reload on mount and on every policyId change –
  // otherwise the spinner stays stuck (empty list) or data from the
  // previous policy is shown. The cleanup invalidates in-flight requests
  // of the previous policyId / after unmount (no state updates afterwards).
  // BugFix-05 (finding 8): the form is also reset on a policyId change – an
  // open form holding data of policy A must not remain under B (a later
  // submit error would otherwise render under B or the fields of A would
  // stay visible).
  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    void reloadPersons();
    // policyId controls the data source; `t` is deliberately not in the
    // dependencies (a language switch must not reload the list).
    return () => { requestSeq.current += 1; };
  }, [policyId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // BugFix-05 (finding 8): seq token like on reload/delete – a submit
    // error of an older request must not render an error message in the
    // (already reset) form of the new policy after a policyId change. The
    // success path runs through reloadPersons(), which sets a new seq itself.
    const seq = requestSeq.current;
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        personName: form.personName,
        subjectType: form.subjectType,
        // BugFix-22: the relation is optional – an empty value clears a
        // previously stored relation instead of leaving it untouched.
        relationType: form.relationType.trim(),
        // BugFix-22: a birth date only exists for a person; `null` clears the
        // stored value when a person is turned into an object. The API treats
        // an empty value as "remove", not as "leave unchanged".
        birthDate: isBirthDateRelevant(form.subjectType) && form.birthDate ? form.birthDate : null,
      };
      let res;
      if (editingId) {
        res = await fetch(`${API_BASE}/households/default/policies/${policyId}/covered-persons/${editingId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`${API_BASE}/households/default/policies/${policyId}/covered-persons`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('common.unknownError'));
      }
      // BugFix-05 (finding 8, review round 5): the form-reset writes are
      // also seq-guarded – a late success of a submit from A must not
      // close/clear B's open form after a policyId change.
      if (seq === requestSeq.current) {
        setForm(EMPTY_FORM);
        setEditingId(null);
        setShowForm(false);
        // Success reload only if no policyId change happened in the meantime
        // – otherwise the stale closure would load policy A's data under B.
        // The new policyId effect already loads B itself.
        reloadPersons();
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setFormError(err instanceof Error ? err.message : t('common.unknownError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (subject: CoveredSubject) => {
    setForm({
      personName: subject.personName,
      subjectType: normalizeCoveredSubjectType(subject.subjectType),
      relationType: subject.relationType ?? '',
      birthDate: subject.birthDate ? subject.birthDate.split('T')[0] : '',
    });
    setEditingId(subject.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('policies.confirmDeletePerson'))) return;
    // BugFix-05 (finding 8): seq token like on reload – an error of an
    // older request must not render an error message under the new policy.
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/covered-persons/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.unknownError'));
      // BugFix-05 (finding 8, review round 4): the success reload is also
      // seq-guarded – after a policyId change the stale closure must not
      // load policy A's data under B.
      if (seq === requestSeq.current) reloadPersons();
    } catch {
      if (seq === requestSeq.current) setError(t('common.unknownError'));
    }
  };

  const cancelEdit = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setFormError(null);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
        <h2>{t('policies.coveredPersons')}</h2>
        <Button variant="primary" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); }}>
          {t('policies.addPerson')}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 'var(--versigo-space-6)', padding: 'var(--versigo-space-4)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--versigo-space-4)' }}>
            <FormField label={t('policies.subjectType')}>
              <Select
                value={form.subjectType}
                onChange={(e) => {
                  const subjectType = normalizeCoveredSubjectType(e.target.value);
                  // BugFix-22: a birth date does not apply to an object – the
                  // value is dropped right away so it cannot be submitted
                  // accidentally after switching the kind back and forth.
                  setForm({
                    ...form,
                    subjectType,
                    birthDate: isBirthDateRelevant(subjectType) ? form.birthDate : '',
                  });
                }}
              >
                {COVERED_SUBJECT_TYPES.map((type) => (
                  <option key={type} value={type}>{t(coveredSubjectLabelKey(type))}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('policies.personName')} required>
              <Input
                value={form.personName}
                onChange={(e) => setForm({ ...form, personName: e.target.value })}
                required
                placeholder={t('policies.personNamePlaceholder')}
              />
            </FormField>
            <FormField label={`${t('policies.relationType')} (${t('common.optional')})`}>
              <Input
                value={form.relationType}
                onChange={(e) => setForm({ ...form, relationType: e.target.value })}
                placeholder={t('policies.relationTypePlaceholder')}
              />
            </FormField>
            {isBirthDateRelevant(form.subjectType) && (
              <FormField label={t('policies.birthDate')}>
                <Input
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                  placeholder={t('policies.birthDate')}
                />
              </FormField>
            )}
          </div>
          {formError && (
            <div style={{ marginTop: 'var(--versigo-space-3)' }}>
              <Alert variant="danger">{formError}</Alert>
            </div>
          )}
          <div style={{ marginTop: 'var(--versigo-space-4)', display: 'flex', gap: 'var(--versigo-space-2)' }}>
            <Button type="submit" disabled={submitting}>
              {submitting ? <><InlineSpinner /> {t('common.saving')}</> : t('common.save')}
            </Button>
            <Button type="button" variant="secondary" onClick={cancelEdit}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--versigo-space-8)' }}>
          <InlineSpinner />
        </div>
      ) : persons.length === 0 ? (
        <EmptyState icon="👤" title={t('policies.noPersonsTitle')}>
          <p>{t('policies.noPersonsBody')}</p>
        </EmptyState>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 'var(--versigo-space-4)' }}>
          {persons.map((subject) => {
            const subjectType = normalizeCoveredSubjectType(subject.subjectType);
            const showsBirthDate = isBirthDateRelevant(subjectType) && Boolean(subject.birthDate);
            return (
              <li key={subject.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--versigo-space-3)', padding: 'var(--versigo-space-3) 0', borderBottom: '1px solid var(--versigo-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--versigo-space-2)', minWidth: 0 }}>
                  <CoveredSubjectIcon subjectType={subject.subjectType} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{subject.personName}</strong>
                    <div className="text-xs text-muted">
                      {t(coveredSubjectLabelKey(subjectType))}
                      {subject.relationType && ` · ${subject.relationType}`}
                      {showsBirthDate && ` · ${t('policies.birthDate')}: ${new Date(subject.birthDate as string).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexShrink: 0 }}>
                  <Button variant="secondary" size="sm" onClick={() => handleEdit(subject)}>{t('policies.editPerson')}</Button>
                  <Button variant="secondary" size="sm" onClick={() => handleDelete(subject.id)}>{t('policies.deletePerson')}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
