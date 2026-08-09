'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { formatDate, useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type QueueOverviewItem = {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
};

type FailedJobItem = {
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string | null;
  finishedOn: string | null;
};

type AiJob = {
  id: string;
  policyId: string;
  providerKey: string;
  model: string | null;
  status: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type AiJobsResponse = {
  statusCounts: Record<string, number>;
  recent: AiJob[];
};

type IntegrationsResponse = {
  ai: { enabled: boolean; provider: string; connected: boolean };
  paperless: { enabled: boolean; connected: boolean };
  portalAccountLinks: { bySyncStatus: Record<string, number> };
  storage: { enabled: boolean };
  portalConnectors: Array<{
    key: string;
    displayName: string;
    experimental: boolean;
    available: boolean;
    healthy: boolean;
    reason: string | null;
    checkedAt: string;
  }>;
};

export default function AdminMonitoringPage(): ReactElement {
  const { t, language } = useI18n();
  const [queues, setQueues] = useState<QueueOverviewItem[] | null>(null);
  const [failedJobs, setFailedJobs] = useState<FailedJobItem[] | null>(null);
  const [aiJobs, setAiJobs] = useState<AiJobsResponse | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  // m1: consistent with the other admin pages (audit/page.tsx, users):
  // 401 -> login redirect, 403 -> /forbidden, otherwise throw instead of
  // silently rendering an "no data" empty image. This way a non-ADMIN
  // never sees a seemingly healthy monitoring view.
  const handleResponse = (res: Response): Promise<unknown> => {
    if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
    if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
    if (!res.ok) return Promise.reject(new Error(t('admin.monitoring.loadError')));
    return res.json();
  };

  const loadAll = () => {
    setLoading(true);
    setError(null);
    const [queuesP, failedP, aiP, integrationsP] = [
      fetch(`${API_BASE}/admin/monitoring/queues`, { credentials: 'include' })
        .then((r) => handleResponse(r) as Promise<QueueOverviewItem[] | null>),
      fetch(`${API_BASE}/admin/monitoring/queues/failed`, { credentials: 'include' })
        .then((r) => handleResponse(r) as Promise<FailedJobItem[] | null>),
      fetch(`${API_BASE}/admin/monitoring/ai-jobs`, { credentials: 'include' })
        .then((r) => handleResponse(r) as Promise<AiJobsResponse | null>),
      fetch(`${API_BASE}/admin/monitoring/integrations`, { credentials: 'include' })
        .then((r) => handleResponse(r) as Promise<IntegrationsResponse | null>),
    ] as const;
    Promise.all([queuesP, failedP, aiP, integrationsP])
      .then(([q, f, a, i]) => {
        // m1: on 401/403 handleResponse returns null and redirects – then
        // no state commits, so already loaded data is not replaced by
        // empty images before navigation takes effect.
        if (q === null || f === null || a === null || i === null) return;
        setQueues(q);
        setFailedJobs(f);
        setAiJobs(a);
        setIntegrations(i);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, [t]);

  const handleRetry = async (jobId: string) => {
    setRetrying(jobId);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/monitoring/queues/failed/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.status === 403) { window.location.href = '/forbidden'; return; }
      if (!res.ok) throw new Error(t('admin.monitoring.retryError'));
      // m1: Nach erfolgreichem Retry alles neu laden – auch die
      // Queue-Zaehler, damit die failed-/completed-Spalten stimmen.
      loadAll();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('admin.monitoring.title')} />
        <Loading label={t('admin.monitoring.loading')} />
      </AppShell>
    );
  }

  const renderStatusBadge = (ok: boolean, okLabel: string, failLabel: string) => (
    <span className={`badge ${ok ? 'badge-success' : 'badge-danger'}`}>{ok ? okLabel : failLabel}</span>
  );

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('admin.monitoring.title')} description={t('admin.monitoring.description')} />

      {error && <Alert variant="danger">{t('common.error')}: {error}</Alert>}

      {/* Queues */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('admin.monitoring.queuesTitle')} />
        {!queues || queues.length === 0 ? (
          <EmptyState icon="⚙️" title={t('admin.monitoring.queuesEmpty')} />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.monitoring.queue')}</th>
                  <th>{t('admin.monitoring.waiting')}</th>
                  <th>{t('admin.monitoring.active')}</th>
                  <th>{t('admin.monitoring.delayed')}</th>
                  <th>{t('admin.monitoring.failed')}</th>
                  <th>{t('admin.monitoring.completed')}</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.queue}>
                    <td data-label={t('admin.monitoring.queue')}><code>{q.queue}</code></td>
                    <td data-label={t('admin.monitoring.waiting')}>{q.waiting}</td>
                    <td data-label={t('admin.monitoring.active')}>{q.active}</td>
                    <td data-label={t('admin.monitoring.delayed')}>{q.delayed}</td>
                    <td data-label={t('admin.monitoring.failed')}>{q.failed}</td>
                    <td data-label={t('admin.monitoring.completed')}>{q.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Failed jobs */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('admin.monitoring.failedTitle')} />
        {!failedJobs || failedJobs.length === 0 ? (
          <EmptyState icon="✅" title={t('admin.monitoring.failedEmpty')} />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.monitoring.jobId')}</th>
                  <th>{t('admin.monitoring.jobName')}</th>
                  <th>{t('admin.monitoring.attempts')}</th>
                  <th>{t('admin.monitoring.failedReason')}</th>
                  <th>{t('admin.monitoring.finishedOn')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {failedJobs.map((job) => (
                  <tr key={job.id}>
                    <td data-label={t('admin.monitoring.jobId')}><code>{job.id}</code></td>
                    <td data-label={t('admin.monitoring.jobName')}>{job.name}</td>
                    <td data-label={t('admin.monitoring.attempts')}>{job.attemptsMade}</td>
                    <td data-label={t('admin.monitoring.failedReason')} style={{ maxWidth: 320 }}>
                      <span style={{ wordBreak: 'break-word' }}>{job.failedReason ?? '—'}</span>
                    </td>
                    <td data-label={t('admin.monitoring.finishedOn')}>
                      {job.finishedOn ? formatDate(job.finishedOn, language) : '—'}
                    </td>
                    <td data-label={t('common.actions')}>
                      <Button variant="secondary" size="sm" disabled={retrying === job.id} onClick={() => handleRetry(job.id)}>
                        {retrying === job.id ? t('admin.monitoring.retrying') : t('admin.monitoring.retry')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* AI jobs */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('admin.monitoring.aiJobsTitle')} />
        {!aiJobs || aiJobs.recent.length === 0 ? (
          <EmptyState icon="🤖" title={t('admin.monitoring.aiJobsEmpty')} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', flexWrap: 'wrap', marginBottom: 'var(--versigo-space-4)' }}>
              {Object.entries(aiJobs.statusCounts).map(([status, count]) => (
                <span key={status} className="badge badge-neutral">
                  {status}: {count}
                </span>
              ))}
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('admin.monitoring.jobId')}</th>
                    <th>{t('admin.monitoring.policyId')}</th>
                    <th>{t('admin.monitoring.provider')}</th>
                    <th>{t('admin.monitoring.model')}</th>
                    <th>{t('admin.monitoring.status')}</th>
                    <th>{t('admin.monitoring.updatedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiJobs.recent.map((job) => (
                    <tr key={job.id}>
                      <td data-label={t('admin.monitoring.jobId')}><code>{job.id}</code></td>
                      <td data-label={t('admin.monitoring.policyId')}><code>{job.policyId}</code></td>
                      <td data-label={t('admin.monitoring.provider')}>{job.providerKey}</td>
                      <td data-label={t('admin.monitoring.model')}>{job.model ?? '—'}</td>
                      <td data-label={t('admin.monitoring.status')}>{job.status}</td>
                      <td data-label={t('admin.monitoring.updatedAt')}>{formatDate(job.updatedAt, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Integrations */}
      <Card>
        <SectionHeader title={t('admin.monitoring.integrationsTitle')} />
        {integrations ? (
          <>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('admin.monitoring.integration')}</th>
                    <th>{t('admin.monitoring.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label={t('admin.monitoring.integration')}>AI ({integrations.ai.provider})</td>
                    <td data-label={t('admin.monitoring.state')}>
                      {renderStatusBadge(integrations.ai.enabled, t('admin.monitoring.enabled'), t('admin.monitoring.disabled'))}
                      {' '}
                      {integrations.ai.enabled && renderStatusBadge(integrations.ai.connected, t('admin.monitoring.connected'), t('admin.monitoring.notConnected'))}
                    </td>
                  </tr>
                  <tr>
                    <td data-label={t('admin.monitoring.integration')}>Paperless-ngx</td>
                    <td data-label={t('admin.monitoring.state')}>
                      {renderStatusBadge(integrations.paperless.enabled, t('admin.monitoring.enabled'), t('admin.monitoring.disabled'))}
                      {' '}
                      {integrations.paperless.enabled && renderStatusBadge(integrations.paperless.connected, t('admin.monitoring.connected'), t('admin.monitoring.notConnected'))}
                    </td>
                  </tr>
                  <tr>
                    <td data-label={t('admin.monitoring.integration')}>Storage</td>
                    <td data-label={t('admin.monitoring.state')}>
                      {renderStatusBadge(integrations.storage.enabled, t('admin.monitoring.enabled'), t('admin.monitoring.disabled'))}
                    </td>
                  </tr>
                  {Object.entries(integrations.portalAccountLinks.bySyncStatus).map(([status, count]) => (
                    <tr key={status}>
                      <td data-label={t('admin.monitoring.integration')}>{t('admin.monitoring.portalLinks')} ({status})</td>
                      <td data-label={t('admin.monitoring.state')}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {integrations.portalConnectors.length > 0 && (
              <div className="table-container" style={{ marginTop: 'var(--versigo-space-4)' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('admin.monitoring.connector')}</th>
                      <th>{t('admin.monitoring.status')}</th>
                      <th>{t('admin.monitoring.reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {integrations.portalConnectors.map((connector) => (
                      <tr key={connector.key}>
                        <td data-label={t('admin.monitoring.connector')}>
                          {connector.displayName}
                          {connector.experimental && <span className="badge badge-neutral" style={{ marginLeft: 'var(--versigo-space-2)' }}>{t('policies.experimental')}</span>}
                        </td>
                        <td data-label={t('admin.monitoring.status')}>
                          {renderStatusBadge(connector.healthy, t('admin.monitoring.healthy'), t('admin.monitoring.unhealthy'))}
                        </td>
                        <td data-label={t('admin.monitoring.reason')}>{connector.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="🔌" title={t('admin.monitoring.integrationsEmpty')} />
        )}
      </Card>
    </AppShell>
  );
}
