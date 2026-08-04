'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { formatDate, useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type AuditEventListItem = {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: string;
  hasDiff: boolean;
};

type AuditEventDetail = AuditEventListItem & {
  diffJson: unknown | null;
};

export default function AdminAuditPage(): ReactElement {
  const { t, language } = useI18n();
  const [events, setEvents] = useState<AuditEventListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [detail, setDetail] = useState<AuditEventDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadEvents = (entityType?: string, action?: string) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ take: '100' });
    if (entityType?.trim()) params.set('entityType', entityType.trim());
    if (action?.trim()) params.set('action', action.trim());
    fetch(`${API_BASE}/admin/audit/events?${params.toString()}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('admin.audit.loadError'));
        return res.json();
      })
      .then((data: { events: AuditEventListItem[]; total: number } | null) => {
        if (data) {
          setEvents(data.events);
          setTotal(data.total);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEvents(); }, [t]);

  const handleFilter = (e: FormEvent) => {
    e.preventDefault();
    loadEvents(entityFilter, actionFilter);
  };

  const handleShowDetail = async (id: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/audit/events/${id}`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.status === 403) { window.location.href = '/forbidden'; return; }
      if (!res.ok) throw new Error(t('admin.audit.detailError'));
      const data: AuditEventDetail = await res.json();
      setDetail(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setLoadingDetail(false);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('admin.audit.title')} />
        <Loading label={t('admin.audit.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('admin.audit.title')} description={t('admin.audit.description')} />

      {error && <Alert variant="danger">{t('common.error')}: {error}</Alert>}

      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title={t('admin.audit.filterTitle')} />
        <form onSubmit={handleFilter} style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label" htmlFor="audit-entity">{t('admin.audit.entityType')}</label>
            <Input
              id="audit-entity"
              type="text"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              placeholder={t('admin.audit.entityTypePlaceholder')}
            />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label" htmlFor="audit-action">{t('admin.audit.action')}</label>
            <Input
              id="audit-action"
              type="text"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder={t('admin.audit.actionPlaceholder')}
            />
          </div>
          <Button type="submit" variant="primary">{t('admin.audit.applyFilter')}</Button>
        </form>
      </Card>

      {detail && (
        <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
          <SectionHeader title={t('admin.audit.detailTitle')} />
          <p style={{ marginBottom: 'var(--versigo-space-3)' }}>
            <strong>{detail.entityType}</strong> / {detail.action} · {detail.actorUsername ?? detail.actorUserId} · {formatDate(detail.createdAt, language)}
          </p>
          {detail.diffJson !== null && detail.diffJson !== undefined ? (
            <pre
              className="audit-diff"
              style={{
                overflow: 'auto',
                maxHeight: 400,
                background: 'var(--versigo-surface-alt)',
                padding: 'var(--versigo-space-3)',
                borderRadius: 'var(--versigo-radius)',
                fontSize: '0.85rem',
              }}
            >
              {JSON.stringify(detail.diffJson, null, 2)}
            </pre>
          ) : (
            <p style={{ margin: 0 }}>{t('admin.audit.noDiff')}</p>
          )}
          <div style={{ marginTop: 'var(--versigo-space-3)' }}>
            <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>{t('common.back')}</Button>
          </div>
        </Card>
      )}

      {loadingDetail && <Loading label={t('admin.audit.loadingDetail')} />}

      <Card>
        <SectionHeader title={t('admin.audit.eventsTitle')} />
        <p style={{ marginBottom: 'var(--versigo-space-3)' }}>
          {t('admin.audit.shownCount', { count: String(events.length), total: String(total) })}
        </p>
        {events.length === 0 ? (
          <EmptyState icon="📋" title={t('admin.audit.emptyTitle')}>
            <p>{t('admin.audit.emptyBody')}</p>
          </EmptyState>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.audit.date')}</th>
                  <th>{t('admin.audit.actor')}</th>
                  <th>{t('admin.audit.entityType')}</th>
                  <th>{t('admin.audit.action')}</th>
                  <th>{t('admin.audit.diff')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td data-label={t('admin.audit.date')}>{formatDate(event.createdAt, language)}</td>
                    <td data-label={t('admin.audit.actor')}>{event.actorUsername ?? event.actorUserId ?? '—'}</td>
                    <td data-label={t('admin.audit.entityType')}><code>{event.entityType}</code></td>
                    <td data-label={t('admin.audit.action')}>{event.action}</td>
                    <td data-label={t('admin.audit.diff')}>
                      {event.hasDiff
                        ? <span className="badge badge-success">{t('common.yes')}</span>
                        : <span className="badge badge-neutral">{t('common.no')}</span>}
                    </td>
                    <td data-label={t('common.actions')}>
                      <Button variant="secondary" size="sm" onClick={() => handleShowDetail(event.id)}>
                        {t('admin.audit.showDetail')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
