'use client';

import { useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, Select, FormField } from '../../../components/ui/form-field';
import { InlineSpinner } from '../../../components/ui/loading';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { useI18n } from '../../../i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const POLICY_TYPES = [
  'HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ',
  'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE',
];

export default function NewPolicyPage(): ReactElement {
  const { t } = useI18n();
  const [form, setForm] = useState({
    type: 'HAFTPFLICHT',
    insurerName: '',
    contractNumber: '',
    startDate: new Date().toISOString().split('T')[0],
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error(t('policies.createError'));
      window.location.href = '/policies';
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('policies.newTitle')} description={t('policies.newDescription')} />

      <Card style={{ maxWidth: 640 }}>
        <form onSubmit={handleSubmit}>
          <FormField label={t('common.type')} required>
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              required
            >
              {POLICY_TYPES.map((typeValue) => (
                <option key={typeValue} value={typeValue}>
                  {t(`policies.types.${typeValue}`) ?? typeValue}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={t('policies.insurer')} required>
            <Input
              value={form.insurerName}
              onChange={(e) => setForm({ ...form, insurerName: e.target.value })}
              required
              placeholder={t('policies.insurerPlaceholder')}
            />
          </FormField>

          <FormField label={t('policies.contractNumber')} required>
            <Input
              value={form.contractNumber}
              onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
              required
              placeholder={t('policies.contractNumberPlaceholder')}
            />
          </FormField>

          <FormField label={t('policies.startDate')} required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </FormField>

          <div style={{ marginTop: 'var(--versigo-space-6)' }}>
            <Button type="submit" disabled={submitting}>
              {submitting ? <><InlineSpinner /> {t('policies.creating')}</> : t('policies.create')}
            </Button>
          </div>
        </form>
      </Card>
    </AppShell>
  );
}
