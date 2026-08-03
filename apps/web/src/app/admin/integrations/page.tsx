'use client';

import { useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, Select } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type ConnectivityResult = {
  success: boolean;
  message: string;
  timestamp: string;
};

export default function AdminIntegrationsPage(): ReactElement {
  const { t } = useI18n();
  const [integrationKey, setIntegrationKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [result, setResult] = useState<ConnectivityResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async (e: FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/admin/connectivity-test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrationKey,
          endpoint: endpoint || undefined,
          apiToken: apiToken || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? t('admin.integrations.testError'));
      }

      const data: ConnectivityResult = await res.json();
      setResult(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('admin.integrations.title')} description={t('admin.integrations.description')} />

      {error && <Alert variant="danger">{t('common.error')}: {error}</Alert>}

      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('admin.integrations.connectivityTest')} />
        <form onSubmit={handleTest} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--versigo-space-3)', maxWidth: 480 }}>
          <div className="form-group">
            <label className="form-label">{t('admin.integrations.key')}</label>
            <Select
              value={integrationKey}
              onChange={(e) => setIntegrationKey(e.target.value)}
              required
            >
              <option value="">{t('admin.integrations.choose')}</option>
              <option value="database">{t('admin.integrations.database')}</option>
              <option value="redis">Redis</option>
              <option value="oidc">{t('admin.integrations.oidc')}</option>
              <option value="paperless">{t('admin.integrations.paperless')}</option>
              <option value="ai">{t('admin.integrations.ai')}</option>
              <option value="storage">{t('admin.integrations.storage')}</option>
              <option value="custom">{t('admin.integrations.custom')}</option>
            </Select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('admin.integrations.endpoint')}</label>
            <Input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://example.com/api"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('admin.integrations.apiToken')}</label>
            <Input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={t('admin.integrations.authOnly')}
            />
          </div>
          <Button type="submit" disabled={testing}>
            {testing ? <><InlineSpinner /> {t('admin.integrations.testing')}</> : t('admin.integrations.startTest')}
          </Button>
        </form>
        <p className="form-hint">
          {t('admin.integrations.testHint')}
        </p>
      </Card>

      {result && (
        <Card>
          <SectionHeader title={t('admin.integrations.resultTitle')} />
          <p>
            {t('admin.integrations.status')}{' '}
            <strong style={{ color: result.success ? 'var(--versigo-success)' : 'var(--versigo-danger)' }}>
              {result.success ? t('admin.integrations.successful') : t('admin.integrations.failed')}
            </strong>
          </p>
          <p>{t('admin.integrations.message')} {result.message}</p>
          <p className="text-xs text-muted">{t('admin.integrations.timestamp')} {result.timestamp}</p>
        </Card>
      )}
    </AppShell>
  );
}
