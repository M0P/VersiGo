'use client';

import { useEffect, useMemo, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, Select } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { Loading } from '../../../components/ui/loading';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import { useI18n, formatDate, type Language } from '../../../i18n';
import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type Source = 'UI' | 'ENV' | 'DEFAULT';
type SettingType = 'boolean' | 'number' | 'string';

/** Struktur wie `SystemConfigEntryDto` der API (identisch zu /admin/settings). */
type SystemConfigEntry = {
  key: string;
  category: 'runtime' | 'restart' | 'secret' | 'bootstrap';
  type: SettingType;
  group: string;
  description: string;
  validationHint: string | null;
  allowedValues: string[] | null;
  min: number | null;
  max: number | null;
  connectivityTestable: boolean;
  secret: boolean;
  effectiveValue: string | number | boolean | null;
  secretSet: boolean | null;
  source: Source;
  reason: string;
  uiValuePresent: boolean;
  uiValueInvalid: boolean;
  restartRequired: boolean;
  pendingRestartValue: string | number | boolean | null;
  uiUpdatedAt: string | null;
  uiUpdatedBy: string | null;
};

type ConnectivityResult = {
  success: boolean;
  message: string;
  timestamp: string;
};

/**
 * BugFix-05 (Befund 1): Benutzerfreundliche Feature-Verwaltung.
 *
 * Statt roher Schluesselnamen zeigt diese Seite pro optionalem Feature eine
 * Karte mit Master-Toggle (das jeweilige *_ENABLED-Setting) und den
 * zugehoerigen Konfigurationsfeldern. Gespeichert wird ausschliesslich ueber
 * den etablierten /admin/system-config-Endpunkt (Katalog-Allowlist +
 * Typvalidierung + Secret-Verschluesselung). `restart`-Kategorie (OIDC,
 * Storage) zeigt "Neustart erforderlich"; `runtime`-Kategorie (KI,
 * Paperless, Family-Sharing) wirkt sofort.
 */
const FEATURES = [
  {
    key: 'ai',
    titleKey: 'admin.features.aiTitle',
    descriptionKey: 'admin.features.aiDescription',
    toggleKey: 'AI_ENABLED',
    toggleLabel: 'admin.features.aiEnabled',
    keys: [
      'AI_ENABLED',
      'AI_PROVIDER',
      'AI_OLLAMA_BASE_URL',
      'AI_OLLAMA_MODEL',
      'AI_OPENAI_COMPAT_BASE_URL',
      'AI_OPENAI_COMPAT_API_KEY',
      'AI_OPENAI_COMPAT_MODEL',
      'AI_EXTRACTION_TIMEOUT_MS',
      'AI_MAX_RETRIES',
    ],
  },
  {
    key: 'oidc',
    titleKey: 'admin.features.oidcTitle',
    descriptionKey: 'admin.features.oidcDescription',
    toggleKey: 'OIDC_ENABLED',
    toggleLabel: 'admin.features.oidcEnabled',
    keys: ['OIDC_ENABLED', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_CALLBACK_URL'],
  },
  {
    key: 'paperless',
    titleKey: 'admin.features.paperlessTitle',
    descriptionKey: 'admin.features.paperlessDescription',
    toggleKey: 'PAPERLESS_ENABLED',
    toggleLabel: 'admin.features.paperlessEnabled',
    keys: ['PAPERLESS_ENABLED', 'PAPERLESS_URL', 'PAPERLESS_API_TOKEN'],
  },
  {
    key: 'storage',
    titleKey: 'admin.features.storageTitle',
    descriptionKey: 'admin.features.storageDescription',
    toggleKey: 'STORAGE_ENABLED',
    toggleLabel: 'admin.features.storageEnabled',
    keys: ['STORAGE_ENABLED'],
  },
  {
    key: 'familySharing',
    titleKey: 'admin.features.familySharingTitle',
    descriptionKey: 'admin.features.familySharingDescription',
    toggleKey: 'FAMILY_SHARING_ENABLED',
    toggleLabel: 'admin.features.familySharingEnabled',
    keys: ['FAMILY_SHARING_ENABLED'],
  },
] as const;

export default function AdminFeaturesPage(): ReactElement {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<SystemConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline-Bearbeitung eines Konfigurationsfelds (key des zu editierenden Settings).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  // Laufende Toggles je Feature (verhindert Doppel-Klicks).
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<
    Record<string, { testing: boolean; result: ConnectivityResult | null }>
  >({});

  const loadEntries = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/admin/system-config`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error(t('admin.features.loadError'));
        return res.json();
      })
      .then((data: SystemConfigEntry[] | null) => { if (data) setEntries(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEntries();
    // `t` bewusst nicht in den Dependencies (Sprachwechsel soll kein Reload
    // der Katalogdaten ausloesen – Muster /admin/settings, Review-3 Minor #1).
  }, []);

  const byKey = useMemo(() => {
    const map = new Map<string, SystemConfigEntry>();
    for (const entry of entries) map.set(entry.key, entry);
    return map;
  }, [entries]);

  const refreshEntry = async (key: string) => {
    const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(key)}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(t('admin.features.refreshError'));
    const updated: SystemConfigEntry = await res.json();
    setEntries((prev) => prev.map((e) => (e.key === updated.key ? updated : e)));
    setTestState((prev) => ({ ...prev, [updated.key]: { testing: false, result: null } }));
  };

  const handleToggle = async (feature: (typeof FEATURES)[number], next: boolean) => {
    setError(null);
    setToggling((prev) => ({ ...prev, [feature.key]: true }));
    try {
      const res = await fetch(
        `${API_BASE}/admin/system-config/${encodeURIComponent(feature.toggleKey)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: next ? 'true' : 'false' }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.features.toggleError'));
      }
      await refreshEntry(feature.toggleKey);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setToggling((prev) => ({ ...prev, [feature.key]: false }));
    }
  };

  const handleStartEdit = (entry: SystemConfigEntry) => {
    setError(null);
    setEditingKey(entry.key);
    if (entry.secret) {
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
        throw new Error(data?.message ?? t('admin.features.saveError'));
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
    if (!window.confirm(t('admin.settings.confirmReset', { key: entry.key }))) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(entry.key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.features.resetError'));
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
      const res = await fetch(
        `${API_BASE}/admin/system-config/${encodeURIComponent(entry.key)}/test`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('admin.features.testError'));
      }
      const result: ConnectivityResult = await res.json();
      setTestState((prev) => ({ ...prev, [entry.key]: { testing: false, result } }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setTestState((prev) => ({
        ...prev,
        [entry.key]: {
          testing: false,
          result: { success: false, message, timestamp: new Date().toISOString() },
        },
      }));
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title={t('admin.features.title')} />
        <Loading label={t('admin.features.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={t('admin.features.title')}
        description={t('admin.features.description')}
      />

      {error && <Alert variant="danger" title={t('common.error')}>{error}</Alert>}

      {FEATURES.map((feature) => {
        const toggleEntry = byKey.get(feature.toggleKey);
        const configEntries = feature.keys
          .map((key) => byKey.get(key))
          .filter((entry): entry is SystemConfigEntry => entry !== undefined);
        const enabled = toggleEntry?.effectiveValue === true;

        return (
          <Card key={feature.key} style={{ marginBottom: 'var(--versigo-space-6)' }}>
            <div className="feature-card-head">
              <div>
                <SectionHeader title={t(feature.titleKey)} />
                <p className="settings-entry-description">{t(feature.descriptionKey)}</p>
              </div>
              {toggleEntry && (
                <div className="feature-toggle">
                  <span className="feature-toggle-label">{t(feature.toggleLabel)}</span>
                  <span className={`badge ${enabled ? 'badge-accent' : 'badge-neutral'}`}>
                    {enabled ? t('common.yes') : t('common.no')}
                  </span>
                  <Button
                    variant={enabled ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={toggling[feature.key]}
                    onClick={() => handleToggle(feature, !enabled)}
                  >
                    {toggling[feature.key]
                      ? t('common.saving')
                      : enabled
                        ? t('admin.features.disable')
                        : t('admin.features.enable')}
                  </Button>
                  {toggleEntry.restartRequired && (
                    <span className="badge badge-warning">{t('admin.settings.restartRequired')}</span>
                  )}
                </div>
              )}
            </div>

            {configEntries.length > 1 && (
              <div className="feature-config-list">
                {configEntries
                  .filter((entry) => entry.key !== feature.toggleKey)
                  .map((entry) => (
                    <FeatureField
                      key={entry.key}
                      entry={entry}
                      editing={editingKey === entry.key}
                      editValue={editValue}
                      saving={saving}
                      testState={testState[entry.key] ?? { testing: false, result: null }}
                      language={language}
                      onEdit={() => handleStartEdit(entry)}
                      onCancel={() => setEditingKey(null)}
                      onEditValueChange={setEditValue}
                      onSave={handleSave}
                      onReset={() => handleReset(entry)}
                      onTest={() => handleTest(entry)}
                    />
                  ))}
              </div>
            )}
          </Card>
        );
      })}
    </AppShell>
  );
}

type FeatureFieldProps = {
  entry: SystemConfigEntry;
  editing: boolean;
  editValue: string;
  saving: boolean;
  testState: { testing: boolean; result: ConnectivityResult | null };
  language: Language;
  onEdit: () => void;
  onCancel: () => void;
  onEditValueChange: (value: string) => void;
  onSave: (e: FormEvent) => void;
  onReset: () => void;
  onTest: () => void;
};

function FeatureField({
  entry,
  editing,
  editValue,
  saving,
  testState,
  language,
  onEdit,
  onCancel,
  onEditValueChange,
  onSave,
  onReset,
  onTest,
}: FeatureFieldProps): ReactElement {
  const { t } = useI18n();
  const editFieldId = `feature-value-${entry.key}`;
  const invalid = entry.uiValueInvalid;

  const displayValue = () => {
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
  };

  return (
    <div className={`feature-field ${invalid ? 'settings-entry-invalid' : ''}`}>
      <div className="feature-field-head">
        <div className="feature-field-title">
          <span className="feature-field-key">{entry.key}</span>
          {entry.secret && <span className="badge badge-neutral">{t('admin.settings.secret')}</span>}
          {entry.restartRequired && (
            <span className="badge badge-warning">{t('admin.settings.restartRequired')}</span>
          )}
        </div>
        <span className={`badge ${entry.source === 'UI' ? 'badge-accent' : 'badge-neutral'}`} title={entry.reason}>
          {entry.source === 'UI'
            ? t('admin.settings.uiSource')
            : entry.source === 'ENV'
              ? t('admin.settings.envSource')
              : t('admin.settings.defaultSource')}
        </span>
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
            <span className="settings-entry-value-text">{displayValue()}</span>
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
            <Alert variant={testState.result.success ? 'success' : 'danger'} id={`feature-test-${entry.key}`}>
              {testState.result.message}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
