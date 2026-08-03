'use client';

import { useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type CoveredPerson = {
  id: string;
  personName: string;
  relationType: string;
  birthDate: string | null;
};

export default function CoveredPersonsTab({ policyId }: { policyId: string }): ReactElement {
  const { t } = useI18n();
  const [persons, setPersons] = useState<CoveredPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    personName: '',
    relationType: '',
    birthDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadPersons = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPersons(data.coveredPersons || []);
      }
    } catch {
      setError(t('policies.noPersonsBody'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        personName: form.personName,
        relationType: form.relationType,
        birthDate: form.birthDate || undefined,
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
      setForm({ personName: '', relationType: '', birthDate: '' });
      setEditingId(null);
      setShowForm(false);
      loadPersons();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (person: CoveredPerson) => {
    setForm({
      personName: person.personName,
      relationType: person.relationType,
      birthDate: person.birthDate ? person.birthDate.split('T')[0] : '',
    });
    setEditingId(person.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('policies.confirmDeletePerson'))) return;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/covered-persons/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.unknownError'));
      loadPersons();
    } catch {
      setError(t('common.unknownError'));
    }
  };

  const cancelEdit = () => {
    setForm({ personName: '', relationType: '', birthDate: '' });
    setEditingId(null);
    setShowForm(false);
    setFormError(null);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
        <h2>{t('policies.coveredPersons')}</h2>
        <Button variant="primary" onClick={() => { setEditingId(null); setForm({ personName: '', relationType: '', birthDate: '' }); setShowForm(true); }}>
          {t('policies.addPerson')}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 'var(--versigo-space-6)', padding: 'var(--versigo-space-4)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--versigo-space-4)' }}>
            <FormField label={t('policies.personName')} required>
              <Input
                value={form.personName}
                onChange={(e) => setForm({ ...form, personName: e.target.value })}
                required
                placeholder={t('policies.personNamePlaceholder')}
              />
            </FormField>
            <FormField label={t('policies.relationType')} required>
              <Input
                value={form.relationType}
                onChange={(e) => setForm({ ...form, relationType: e.target.value })}
                required
                placeholder={t('policies.relationTypePlaceholder')}
              />
            </FormField>
            <FormField label={t('policies.birthDate')}>
              <Input
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                placeholder={t('policies.birthDate')}
              />
            </FormField>
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
          {persons.map((p) => (
            <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--versigo-space-3) 0', borderBottom: '1px solid var(--versigo-border)' }}>
              <div>
                <strong>{p.personName}</strong> <span className="text-muted">({p.relationType})</span>
                {p.birthDate && <span className="text-xs text-muted" style={{ marginLeft: 'var(--versigo-space-2)' }}>{t('policies.birthDate')}: {new Date(p.birthDate).toLocaleDateString()}</span>}
              </div>
              <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
                <Button variant="secondary" size="sm" onClick={() => handleEdit(p)}>{t('policies.editPerson')}</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(p.id)}>{t('policies.deletePerson')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}