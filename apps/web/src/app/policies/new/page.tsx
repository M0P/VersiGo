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

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

const POLICY_TYPES = [
  'HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ',
  'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE',
];

const PAYMENT_FREQUENCIES = [
  'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL',
];

export default function NewPolicyPage(): ReactElement {
  const { t } = useI18n();
  const [form, setForm] = useState({
    type: 'HAFTPFLICHT',
    insurerName: '',
    insurerPortalUrl: '',
    contractNumber: '',
    tariffName: '',
    status: 'ACTIVE',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    renewalDate: '',
    noticePeriod: '',
    paymentFrequency: 'MONTHLY',
    premiumAmount: '',
    deductibleAmount: '',
    coverageSummaryShort: '',
    source: 'MANUAL',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validateForm(): boolean {
    const newErrors: Record<string, string> = {};
    if (!form.type) newErrors.type = t('common.required');
    if (!form.insurerName.trim()) newErrors.insurerName = t('common.required');
    if (!form.contractNumber.trim()) newErrors.contractNumber = t('common.required');
    if (!form.startDate) newErrors.startDate = t('common.required');
    if (form.premiumAmount && isNaN(Number(form.premiumAmount))) newErrors.premiumAmount = t('common.invalidNumber');
    if (form.deductibleAmount && isNaN(Number(form.deductibleAmount))) newErrors.deductibleAmount = t('common.invalidNumber');
    if (form.noticePeriod && (isNaN(Number(form.noticePeriod)) || Number(form.noticePeriod) < 1)) newErrors.noticePeriod = t('common.invalidNumber');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const payload = {
        type: form.type,
        insurerName: form.insurerName,
        insurerPortalUrl: form.insurerPortalUrl || undefined,
        contractNumber: form.contractNumber,
        tariffName: form.tariffName || undefined,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        renewalDate: form.renewalDate || undefined,
        noticePeriod: form.noticePeriod ? Number(form.noticePeriod) : undefined,
        paymentFrequency: form.paymentFrequency || undefined,
        premiumAmount: form.premiumAmount ? Number(form.premiumAmount) : undefined,
        deductibleAmount: form.deductibleAmount ? Number(form.deductibleAmount) : undefined,
        coverageSummaryShort: form.coverageSummaryShort || undefined,
        source: form.source,
      };
      const res = await fetch(`${API_BASE}/households/default/policies`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('policies.createError'));
      }
      window.location.href = '/policies';
    } catch (err) {
      const message = err instanceof Error ? err.message : t('policies.createError');
      setErrors({ submit: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('policies.newTitle')} description={t('policies.newDescription')} />

      <Card style={{ maxWidth: 720 }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--versigo-space-4)' }}>
            <FormField label={t('common.type')} required error={errors.type}>
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

            <FormField label={t('policies.status')} required>
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                required
              >
                <option value="ACTIVE">{t('policies.statuses.ACTIVE')}</option>
                <option value="CANCELLED">{t('policies.statuses.CANCELLED')}</option>
                <option value="EXPIRED">{t('policies.statuses.EXPIRED')}</option>
                <option value="ARCHIVED">{t('policies.statuses.ARCHIVED')}</option>
              </Select>
            </FormField>

            <FormField label={t('policies.insurer')} required error={errors.insurerName}>
              <Input
                value={form.insurerName}
                onChange={(e) => setForm({ ...form, insurerName: e.target.value })}
                required
                placeholder={t('policies.insurerPlaceholder')}
              />
            </FormField>

            <FormField label={t('policies.insurerPortalUrl')}>
              <Input
                type="url"
                value={form.insurerPortalUrl}
                onChange={(e) => setForm({ ...form, insurerPortalUrl: e.target.value })}
                placeholder={t('policies.insurerPortalUrlPlaceholder')}
              />
            </FormField>

            <FormField label={t('policies.contractNumber')} required error={errors.contractNumber}>
              <Input
                value={form.contractNumber}
                onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
                required
                placeholder={t('policies.contractNumberPlaceholder')}
              />
            </FormField>

            <FormField label={t('policies.tariff')}>
              <Input
                value={form.tariffName}
                onChange={(e) => setForm({ ...form, tariffName: e.target.value })}
                placeholder={t('policies.tariffPlaceholder')}
              />
            </FormField>

            <FormField label={t('policies.startDate')} required error={errors.startDate}>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </FormField>

            <FormField label={t('policies.endDate')}>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormField>

            <FormField label={t('policies.renewalDate')}>
              <Input
                type="date"
                value={form.renewalDate}
                onChange={(e) => setForm({ ...form, renewalDate: e.target.value })}
              />
            </FormField>

            <FormField label={t('policies.noticePeriod')} error={errors.noticePeriod}>
              <Input
                type="number"
                min="1"
                value={form.noticePeriod}
                onChange={(e) => setForm({ ...form, noticePeriod: e.target.value })}
                placeholder={t('policies.noticePeriod')}
              />
            </FormField>

            <FormField label={t('policies.paymentFrequency')}>
              <Select
                value={form.paymentFrequency}
                onChange={(e) => setForm({ ...form, paymentFrequency: e.target.value })}
              >
                {PAYMENT_FREQUENCIES.map((freq) => (
                  <option key={freq} value={freq}>
                    {t(`costs.frequencies.${freq}`) ?? freq}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label={t('policies.premiumAmount')} error={errors.premiumAmount}>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.premiumAmount}
                onChange={(e) => setForm({ ...form, premiumAmount: e.target.value })}
                placeholder={t('policies.premiumAmount')}
              />
            </FormField>

            <FormField label={t('policies.deductibleAmount')} error={errors.deductibleAmount}>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.deductibleAmount}
                onChange={(e) => setForm({ ...form, deductibleAmount: e.target.value })}
                placeholder={t('policies.deductibleAmount')}
              />
            </FormField>

            <FormField label={t('policies.coverageSummaryShort')}>
              <Input
                value={form.coverageSummaryShort}
                onChange={(e) => setForm({ ...form, coverageSummaryShort: e.target.value })}
                placeholder={t('policies.coverageSummaryShort')}
              />
            </FormField>

            <FormField label={t('policies.source')}>
              <Select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              >
                <option value="MANUAL">{t('policies.types.MANUAL') ?? 'Manual'}</option>
                <option value="AI_EXTRACTED">{t('policies.types.AI_EXTRACTED') ?? 'AI Extracted'}</option>
                <option value="IMPORTED">{t('policies.types.IMPORTED') ?? 'Imported'}</option>
              </Select>
            </FormField>
          </div>

          {errors.submit && (
            <div style={{ marginTop: 'var(--versigo-space-4)', padding: 'var(--versigo-space-3)', background: 'var(--versigo-danger-soft)', borderRadius: 'var(--versigo-radius)', color: 'var(--versigo-danger)' }}>
              {errors.submit}
            </div>
          )}

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
