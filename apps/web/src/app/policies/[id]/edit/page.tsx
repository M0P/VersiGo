'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/ui/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, FormField } from '@/components/ui/form-field';
import { InlineSpinner } from '@/components/ui/loading';
import { Alert } from '@/components/ui/alert';
import { NAV_SECTIONS } from '@/components/ui/nav-config';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { normalizePortalUrl } from '@/lib/portal-url';

const API_BASE = getApiBaseUrl();

const POLICY_TYPES = [
  'HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ',
  'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE',
];

const PAYMENT_FREQUENCIES = [
  'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL',
];

export default function EditPolicyPage(): ReactElement {
  const params = useParams();
  const router = useRouter();
  const policyId = params.id as string;
  const { t } = useI18n();
  const [form, setForm] = useState({
    type: 'HAFTPFLICHT',
    insurerName: '',
    insurerPortalUrl: '',
    contractNumber: '',
    tariffName: '',
    status: 'ACTIVE',
    startDate: '',
    endDate: '',
    renewalDate: '',
    noticePeriod: '',
    paymentFrequency: 'MONTHLY',
    premiumAmount: '',
    deductibleAmount: '',
    coverageSummaryShort: '',
    source: 'MANUAL',
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`${API_BASE}/households/default/policies/${policyId}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('policies.notFound'));
        return res.json();
      })
      .then((data) => {
        if (data) {
          setForm({
            type: data.type,
            insurerName: data.insurerName,
            insurerPortalUrl: data.insurerPortalUrl ?? '',
            contractNumber: data.contractNumber,
            tariffName: data.tariffName ?? '',
            status: data.status,
            startDate: data.startDate ? data.startDate.split('T')[0] : '',
            endDate: data.endDate ? data.endDate.split('T')[0] : '',
            renewalDate: data.renewalDate ? data.renewalDate.split('T')[0] : '',
            noticePeriod: data.noticePeriod ?? '',
            paymentFrequency: data.paymentFrequency ?? 'MONTHLY',
            premiumAmount: data.premiumAmount ?? '',
            deductibleAmount: data.deductibleAmount ?? '',
            coverageSummaryShort: data.coverageSummaryShort ?? '',
            source: data.source ?? 'MANUAL',
          });
        }
      })
      .catch(() => setErrors({ load: t('policies.notFoundAlert') }))
      .finally(() => setLoading(false));
  }, [policyId, t]);

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
        insurerPortalUrl: form.insurerPortalUrl ? normalizePortalUrl(form.insurerPortalUrl) : undefined,
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
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('policies.createError'));
      }
      router.push(`/policies/${policyId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('policies.createError');
      setErrors({ submit: message });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('policies.detailTitle')} />
        <div style={{ textAlign: 'center', padding: 'var(--versigo-space-8)' }}>
          <span className="loading-spinner" style={{ width: 32, height: 32 }} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('policies.newTitle')}
        description={t('policies.newDescription')}
        actions={
          <a href={`/policies/${policyId}`}>
            <Button variant="secondary" size="sm">{t('policies.backToOverview')}</Button>
          </a>
        }
      />

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
                <option value="MANUAL">{t('policies.sources.MANUAL') ?? 'Manual entry'}</option>
                <option value="AI_EXTRACTED">{t('policies.sources.AI_EXTRACTED') ?? 'AI extraction'}</option>
                <option value="IMPORTED">{t('policies.sources.IMPORTED') ?? 'Import'}</option>
              </Select>
            </FormField>
          </div>

          {(errors.load || errors.submit) && (
            <div style={{ marginTop: 'var(--versigo-space-4)' }}>
              <Alert variant="danger">{errors.load || errors.submit}</Alert>
            </div>
          )}

          <div style={{ marginTop: 'var(--versigo-space-6)', display: 'flex', gap: 'var(--versigo-space-3)' }}>
            <Button type="submit" disabled={submitting}>
              {submitting ? <><InlineSpinner /> {t('common.saving')}</> : t('common.save')}
            </Button>
            <a href={`/policies/${policyId}`}>
              <Button type="button" variant="secondary">{t('common.cancel')}</Button>
            </a>
          </div>
        </form>
      </Card>
    </AppShell>
  );
}