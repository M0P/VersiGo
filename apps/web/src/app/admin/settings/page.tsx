'use client';

import { useEffect, useMemo, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, Select } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { AdminFeaturesSection, FEATURE_KEYS, type SystemConfigEntry, type ConnectivityResult } from '../../../components/admin/features-section';
import { useI18n, formatDate } from '../../../i18n';
import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type Source = 'UI' | 'ENV' | 'DEFAULT';

const SOURCE_BADGE: Record<Source, string> = {
  UI: 'badge-accent',
  ENV: 'badge-neutral',
  DEFAULT: 'badge-neutral',
};

/**
 * Lesbares Anzeigeformat eines effektiven Werts (Secrets immer maskiert).
 * Uebersetzte Werte stammen aus dem aufrufenden Hook (t).
 */
function formatEffectiveValue(entry: SystemConfigEntry, t: (key: string, params?: Record<string, string>) => string): string {
  if (entry.secret) {
    return entry.secretSet ? '••••••••' : t('admin.settings.notSet');
  }
  if (entry.type === 'boolean') {
    if (entry.effectiveValue === true) return t('common.yes');
    if (entry.effectiveValue === false) return t('common.no');
    return '—';
  }
  return entry.effectiveValue !== null && entry.effectiveValue !== undefined
    ? String(entry.effectiveValue)
    : '—';
}

export default function AdminSettingsPage(): ReactElement {
  const { t } = useI18n();
  const [entries, setEntries] = useState<SystemConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | Source>('ALL');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [onlyRestart, setOnlyRestart] = useState(false);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<Record<string, { testing: boolean; result: ConnectivityResult | null }>>({});

  // BugFix-06 (Teil 3.4): Dienste-Neustart ueber die UI.
  const [restarting, setRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadEntries = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/admin/system-config`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('admin.settings.errorLoading'));
        return res.json();
      })
      .then((data: SystemConfigEntry[] | null) => { if (data) setEntries(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // `t` ist bewusst NICHT in den Dependencies: ein Sprachwechsel erzeugt
    // eine neue `t`-Referenz und wuerde sonst ein redundantes
    // GET /admin/system-config ausloesen (Review-3, Minor #1).
    loadEntries();
  }, []);

  // BugFix-07 (Q1): Der Katalog unterhalb der Feature-Karten zeigt keine
  // Schluessel, die bereits von den Karten verwaltet werden (keine Duplikate).
  const catalogEntries = useMemo(
    () => entries.filter((entry) => !FEATURE_KEYS.includes(entry.key)),
    [entries],
  );

  // --- Filterung (Suche + Quelle + Probleme + Neustartbedarf) ---
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalogEntries.filter((entry) => {
      if (query) {
        const haystack = `${entry.key} ${entry.group} ${entry.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (sourceFilter !== 'ALL' && entry.source !== sourceFilter) return false;
      if (onlyProblems && !entry.uiValueInvalid) return false;
      if (onlyRestart && !entry.restartRequired) return false;
      return true;
    });
  }, [catalogEntries, search, sourceFilter, onlyProblems, onlyRestart]);

  // Gruppierung in Katalog-Reihenfolge (Reihenfolge der API-Antwort).
  const grouped = useMemo(() => {
    const groups = new Map<string, SystemConfigEntry[]>();
    for (const entry of filtered) {
      const list = groups.get(entry.group) ?? [];
      list.push(entry);
      groups.set(entry.group, list);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  const hasActiveFilters = search.trim() !== '' || sourceFilter !== 'ALL' || onlyProblems || onlyRestart;

  const refreshEntry = async (key: string): Promise<SystemConfigEntry | null> => {
    try {
      const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(key)}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.settings.refreshError'));
      const updated: SystemConfigEntry = await res.json();
      setEntries((prev) => prev.map((e) => (e.key === updated.key ? updated : e)));
      setTestState((prev) => ({ ...prev, [updated.key]: { testing: false, result: null } }));
      return updated;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
      return null;
    }
  };

  const handleStartEdit = (entry: SystemConfigEntry) => {
    setError(null);
    setEditingKey(entry.key);
    if (entry.secret) {
      // Secrets werden niemals angezeigt – Feld bleibt leer (Ersetzen).
      setEditValue('');
    } else if (entry.type === 'boolean') {
      setEditValue(entry.effectiveValue === true ? 'true' : 'false');
    } else if (entry.effectiveValue !== null && entry.effectiveValue !== undefined) {
      setEditValue(String(entry.effectiveValue));
    } else {
      setEditValue('');
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(editingKey)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: editValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.settings.saveError'));
      }
      setEditingKey(null);
      await refreshEntry(editingKey);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (entry: SystemConfigEntry) => {
    if (!window.confirm(t('admin.settings.confirmReset', { key: entry.key }))) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(entry.key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.settings.resetError'));
      }
      if (editingKey === entry.key) setEditingKey(null);
      await refreshEntry(entry.key);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    }
  };

  const handleTest = async (entry: SystemConfigEntry) => {
    setError(null);
    setTestState((prev) => ({ ...prev, [entry.key]: { testing: true, result: null } }));
    try {
      const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(entry.key)}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.settings.testError'));
      }
      const result: ConnectivityResult = await res.json();
      setTestState((prev) => ({ ...prev, [entry.key]: { testing: false, result } }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setTestState((prev) => ({ ...prev, [entry.key]: { testing: false, result: { success: false, message, timestamp: new Date().toISOString() } } }));
    }
  };

  // BugFix-06 (Teil 3.4): Neustart von API und Worker. Nach Bestaetigung
  // wird der geschuetzte Admin-Endpunkt aufgerufen; die API beendet sich
  // kurz danach kontrolliert selbst (Compose restart: unless-stopped).
  const handleRestart = async () => {
    if (!window.confirm(t('admin.settings.confirmRestart'))) {
      return;
    }
    setError(null);
    setRestartMessage(null);
    setRestarting(true);
    try {
      const res = await fetch(`${API_BASE}/admin/restart`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.settings.restartError'));
      }
      setRestartMessage({ ok: true, text: t('admin.settings.restartTriggered') });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('admin.settings.restartError');
      setRestartMessage({ ok: false, text: message });
    } finally {
      setRestarting(false);
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('admin.settings.title')} />
        <Loading label={t('admin.settings.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('admin.settings.title')}
        description={t('admin.settings.description')}
      />

      {error && <Alert variant="danger" title={t('common.error')}>{error}</Alert>}

      {/* BugFix-07 (Q1): Feature-Karten (vorher /admin/features) – oben,
          darunter der vollstaendige Katalog ohne doppelte Schluessel. */}
      <SectionHeader title={t('admin.features.title')} />
      <AdminFeaturesSection
        entries={entries}
        onEntryRefresh={refreshEntry}
        onError={(message) => {
          if (message) setError(message);
        }}
      />

      {/* BugFix-06 (Teil 3.4): Dienste-Neustart fuer Restart-Kategorie-Settings */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <div className="settings-restart-row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>{t('admin.settings.restartServices')}</strong>
            <p className="form-hint" style={{ margin: 0 }}>
              {t('admin.settings.restartServicesHint')}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleRestart} disabled={restarting}>
            {restarting ? t('common.saving') : t('admin.settings.restartServices')}
          </Button>
        </div>
        {restartMessage && (
          <div style={{ marginTop: 'var(--versigo-space-3)' }}>
            <Alert variant={restartMessage.ok ? 'success' : 'danger'}>
              {restartMessage.text}
            </Alert>
          </div>
        )}
      </Card>

      {/* BugFix-07 (Q1): Katalog unterhalb der Feature-Karten. */}
      <SectionHeader title={t('admin.settings.catalogTitle')} />
      <p className="form-hint">{t('admin.settings.catalogDescription')}</p>

      {/* Werkzeugleiste: Suche + Filter */}
      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <div className="settings-toolbar">
          <div className="form-group" style={{ flex: 2, minWidth: 220 }}>
            <label className="form-label" htmlFor="settings-search">{t('admin.settings.search')}</label>
            <Input
              id="settings-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.settings.searchPlaceholder')}
            />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label" htmlFor="settings-source">{t('admin.settings.source')}</label>
            <Select
              id="settings-source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'ALL' | Source)}
            >
              <option value="ALL">{t('admin.settings.allSources')}</option>
              <option value="UI">{t('admin.settings.uiSource')}</option>
              <option value="ENV">{t('admin.settings.envSource')}</option>
              <option value="DEFAULT">{t('admin.settings.defaultSource')}</option>
            </Select>
          </div>
          <div className="settings-filter-checks">
            <label className="form-check">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblems(e.target.checked)}
              />
              {t('admin.settings.onlyInvalid')}
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                checked={onlyRestart}
                onChange={(e) => setOnlyRestart(e.target.checked)}
              />
              {t('admin.settings.onlyRestart')}
            </label>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="⚙️" title={hasActiveFilters ? t('admin.settings.noResults') : t('admin.settings.noSettings')}>
            {hasActiveFilters
              ? t('admin.settings.noResultsBody')
              : t('admin.settings.noSettingsBody')}
          </EmptyState>
        </Card>
      ) : (
        grouped.map(([group, groupEntries]) => (
          <Card key={group} className="settings-group" style={{ marginBottom: 'var(--versigo-space-6)' }}>
            <SectionHeader title={group} />
            <div className="settings-entry-list">
              {groupEntries.map((entry) => (
                <SettingRow
                  key={entry.key}
                  entry={entry}
                  editing={editingKey === entry.key}
                  editValue={editValue}
                  saving={saving}
                  testState={testState[entry.key] ?? { testing: false, result: null }}
                  onEdit={() => handleStartEdit(entry)}
                  onCancel={() => setEditingKey(null)}
                  onEditValueChange={setEditValue}
                  onSave={handleSave}
                  onReset={() => handleReset(entry)}
                  onTest={() => handleTest(entry)}
                />
              ))}
            </div>
          </Card>
        ))
      )}

      {/* M5: Transparenz zur SSRF-Beschraenkung der Verbindungstests. */}
      <p className="form-hint">
        {t('admin.settings.ssrfHint')}
      </p>
    </AppShell>
  );
}

type SettingRowProps = {
  entry: SystemConfigEntry;
  editing: boolean;
  editValue: string;
  saving: boolean;
  testState: { testing: boolean; result: ConnectivityResult | null };
  onEdit: () => void;
  onCancel: () => void;
  onEditValueChange: (value: string) => void;
  onSave: (e: FormEvent) => void;
  onReset: () => void;
  onTest: () => void;
};

function SettingRow({
  entry,
  editing,
  editValue,
  saving,
  testState,
  onEdit,
  onCancel,
  onEditValueChange,
  onSave,
  onReset,
  onTest,
}: SettingRowProps): ReactElement {
  const { t, language } = useI18n();
  const editFieldId = `settings-value-${entry.key}`;
  const invalid = entry.uiValueInvalid;

  const sourceLabel: Record<Source, string> = {
    UI: t('admin.settings.uiSource'),
    ENV: t('admin.settings.envSource'),
    DEFAULT: t('admin.settings.defaultSource'),
  };

  return (
    <div className={`settings-entry ${invalid ? 'settings-entry-invalid' : ''}`}>
      <div className="settings-entry-head">
        <code className="settings-entry-key">{entry.key}</code>
        <span className={`badge ${SOURCE_BADGE[entry.source]}`} title={entry.reason}>
          {sourceLabel[entry.source]}
        </span>
        {entry.secret && <span className="badge badge-neutral">{t('admin.settings.secret')}</span>}
        {entry.restartRequired && (
          <span className="badge badge-warning">{t('admin.settings.restartRequired')}</span>
        )}
      </div>

      <p className="settings-entry-description">{entry.description}</p>

      {invalid && (
        <Alert variant="warning" title={t('admin.settings.invalidUiValue')}>
          {t('admin.settings.invalidUiValueBody')}
        </Alert>
      )}

      {editing ? (
        <form onSubmit={onSave} className="settings-entry-form">
          <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label" htmlFor={editFieldId}>
              {entry.secret ? t('admin.settings.newSecretValue') : t('admin.settings.value')}
            </label>
            {entry.type === 'boolean' ? (
              <Select id={editFieldId} value={editValue} onChange={(e) => onEditValueChange(e.target.value)} required>
                <option value="true">{t('common.yes')}</option>
                <option value="false">{t('common.no')}</option>
              </Select>
            ) : entry.allowedValues ? (
              <Select id={editFieldId} value={editValue} onChange={(e) => onEditValueChange(e.target.value)} required>
                <option value="" disabled>{t('admin.settings.choose')}</option>
                {entry.allowedValues.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            ) : (
              <Input
                id={editFieldId}
                type={entry.type === 'number' ? 'number' : entry.secret ? 'password' : 'text'}
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                min={entry.min ?? undefined}
                max={entry.max ?? undefined}
                step={entry.type === 'number' ? 1 : undefined}
                placeholder={entry.secret ? t('admin.settings.enterNewValue') : t('admin.settings.enterValue')}
                required
                autoFocus
              />
            )}
            {entry.validationHint && <span className="form-hint">{entry.validationHint}</span>}
          </div>
          <div className="btn-group" style={{ alignItems: 'end' }}>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="settings-entry-value">
            <span className="settings-entry-value-label">{t('admin.settings.effectiveValue')}</span>
            <span className="settings-entry-value-text">{formatEffectiveValue(entry, t)}</span>
          </div>
          {entry.pendingRestartValue !== null && entry.pendingRestartValue !== undefined && (
            <div className="settings-entry-value">
              <span className="settings-entry-value-label">{t('admin.settings.valueAfterRestart')}</span>
              <span className="settings-entry-value-text">
                {entry.secret ? '••••••••' : String(entry.pendingRestartValue)}
              </span>
            </div>
          )}
          <p className="settings-entry-reason">
            {entry.reason}
            {entry.uiUpdatedAt && (
              <span className="settings-entry-updated">
                {' · '}{t('admin.settings.lastChanged', { date: formatDate(entry.uiUpdatedAt, language) })}
                {entry.uiUpdatedBy ? t('admin.settings.by', { user: entry.uiUpdatedBy }) : ''}
              </span>
            )}
          </p>
          <div className="btn-group">
            <Button variant="secondary" size="sm" onClick={onEdit}>{t('common.edit')}</Button>
            {entry.uiValuePresent && (
              <Button variant="ghost" size="sm" onClick={onReset}>{t('common.reset')}</Button>
            )}
            {entry.connectivityTestable && (
              <Button variant="outline" size="sm" onClick={onTest} disabled={testState.testing}>
                {testState.testing ? t('admin.integrations.testing') : t('admin.settings.connectionTest')}
              </Button>
            )}
          </div>
          {testState.result && (
            <Alert variant={testState.result.success ? 'success' : 'danger'} id={`settings-test-${entry.key}`}>
              {testState.result.message}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
