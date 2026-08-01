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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Source = 'UI' | 'ENV' | 'DEFAULT';
type SettingType = 'boolean' | 'number' | 'string';

/**
 * Admin-UI-Ansicht eines katalogisierten System-Settings (AP-17).
 * Die Struktur entspricht exakt `SystemConfigEntryDto` der API.
 */
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
  /** m2: erst nach Neustart aktiver UI-Wert (Restart-Kategorie). */
  pendingRestartValue: string | number | boolean | null;
  uiUpdatedAt: string | null;
  uiUpdatedBy: string | null;
};

type ConnectivityResult = {
  success: boolean;
  message: string;
  timestamp: string;
};

const SOURCE_LABEL: Record<Source, string> = {
  UI: 'UI',
  ENV: '.env',
  DEFAULT: 'Default',
};

const SOURCE_BADGE: Record<Source, string> = {
  UI: 'badge-accent',
  ENV: 'badge-neutral',
  DEFAULT: 'badge-neutral',
};

/** Lesbares Anzeigeformat eines effektiven Werts (Secrets immer maskiert). */
function formatEffectiveValue(entry: SystemConfigEntry): string {
  if (entry.secret) {
    return entry.secretSet ? '••••••••' : 'Nicht gesetzt';
  }
  if (entry.type === 'boolean') {
    if (entry.effectiveValue === true) return 'Ja';
    if (entry.effectiveValue === false) return 'Nein';
    return '—';
  }
  return entry.effectiveValue !== null && entry.effectiveValue !== undefined
    ? String(entry.effectiveValue)
    : '—';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('de-DE');
  } catch {
    return iso;
  }
}

export default function AdminSettingsPage(): ReactElement {
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

  const loadEntries = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/admin/system-config`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler beim Laden der Systemeinstellungen');
        return res.json();
      })
      .then((data: SystemConfigEntry[] | null) => { if (data) setEntries(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEntries(); }, []);

  // --- Filterung (Suche + Quelle + Probleme + Neustartbedarf) ---
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (query) {
        const haystack = `${entry.key} ${entry.group} ${entry.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (sourceFilter !== 'ALL' && entry.source !== sourceFilter) return false;
      if (onlyProblems && !entry.uiValueInvalid) return false;
      if (onlyRestart && !entry.restartRequired) return false;
      return true;
    });
  }, [entries, search, sourceFilter, onlyProblems, onlyRestart]);

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

  const refreshEntry = async (key: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/system-config/${encodeURIComponent(key)}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Fehler beim Aktualisieren');
      const updated: SystemConfigEntry = await res.json();
      setEntries((prev) => prev.map((e) => (e.key === updated.key ? updated : e)));
      setTestState((prev) => ({ ...prev, [updated.key]: { testing: false, result: null } }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
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
        throw new Error(data?.message ?? 'Fehler beim Speichern');
      }
      setEditingKey(null);
      await refreshEntry(editingKey);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (entry: SystemConfigEntry) => {
    if (!window.confirm(`UI-Wert für "${entry.key}" zurücksetzen?\n\nDer effektive Wert fällt danach auf .env bzw. den Code-Default zurück.`)) {
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
        throw new Error(data?.message ?? 'Fehler beim Zurücksetzen');
      }
      if (editingKey === entry.key) setEditingKey(null);
      await refreshEntry(entry.key);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
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
        throw new Error(data?.message ?? 'Fehler beim Verbindungstest');
      }
      const result: ConnectivityResult = await res.json();
      setTestState((prev) => ({ ...prev, [entry.key]: { testing: false, result } }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setTestState((prev) => ({ ...prev, [entry.key]: { testing: false, result: { success: false, message, timestamp: new Date().toISOString() } } }));
    }
  };

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Systemeinstellungen" />
        <Loading label="Lade Systemeinstellungen..." />
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title="Systemeinstellungen"
        description="Zentrale, katalogbasierte Konfiguration. UI-Werte haben Vorrang vor .env; fehlt ein Wert, greift ein dokumentierter Code-Default."
      />

      {error && <Alert variant="danger" title="Fehler">{error}</Alert>}

      {/* Werkzeugleiste: Suche + Filter */}
      <Card style={{ marginBottom: 'var(--insura-space-6)' }}>
        <div className="settings-toolbar">
          <div className="form-group" style={{ flex: 2, minWidth: 220 }}>
            <label className="form-label" htmlFor="settings-search">Suche</label>
            <Input
              id="settings-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Schlüssel, Gruppe oder Beschreibung…"
            />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label" htmlFor="settings-source">Quelle</label>
            <Select
              id="settings-source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'ALL' | Source)}
            >
              <option value="ALL">Alle Quellen</option>
              <option value="UI">UI (Datenbank)</option>
              <option value="ENV">.env / Umgebung</option>
              <option value="DEFAULT">Code-Default</option>
            </Select>
          </div>
          <div className="settings-filter-checks">
            <label className="form-check">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblems(e.target.checked)}
              />
              Nur ungültige UI-Werte
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                checked={onlyRestart}
                onChange={(e) => setOnlyRestart(e.target.checked)}
              />
              Nur Neustart erforderlich
            </label>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="⚙️" title={hasActiveFilters ? 'Keine Treffer' : 'Keine Einstellungen'}>
            {hasActiveFilters
              ? 'Kein Eintrag passt zur aktuellen Suche bzw. den aktiven Filtern.'
              : 'Es sind keine katalogisierten Systemeinstellungen vorhanden.'}
          </EmptyState>
        </Card>
      ) : (
        grouped.map(([group, groupEntries]) => (
          <Card key={group} className="settings-group" style={{ marginBottom: 'var(--insura-space-6)' }}>
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
        Verbindungstests sind aus Sicherheitsgründen (SSRF-Schutz) nur gegen
        öffentliche http(s)-Endpunkte möglich. Lokale Dienste (z.&nbsp;B. Ollama
        unter localhost) sind nicht über die UI testbar – prüfen Sie deren
        Erreichbarkeit bitte direkt auf dem Host.
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
  const editFieldId = `settings-value-${entry.key}`;
  const invalid = entry.uiValueInvalid;

  return (
    <div className={`settings-entry ${invalid ? 'settings-entry-invalid' : ''}`}>
      <div className="settings-entry-head">
        <code className="settings-entry-key">{entry.key}</code>
        <span className={`badge ${SOURCE_BADGE[entry.source]}`} title={entry.reason}>
          {SOURCE_LABEL[entry.source]}
        </span>
        {entry.secret && <span className="badge badge-neutral">Secret</span>}
        {entry.restartRequired && (
          <span className="badge badge-warning">Neustart erforderlich</span>
        )}
      </div>

      <p className="settings-entry-description">{entry.description}</p>

      {invalid && (
        <Alert variant="warning" title="Ungültiger UI-Wert">
          Der gespeicherte UI-Wert ist ungültig und wird ignoriert – der
          effektive Wert stammt aus .env bzw. dem Code-Default. Bitte korrigieren
          oder zurücksetzen.
        </Alert>
      )}

      {editing ? (
        <form onSubmit={onSave} className="settings-entry-form">
          <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label" htmlFor={editFieldId}>
              {entry.secret ? 'Neuer Wert (ersetzt den gespeicherten)' : 'Wert'}
            </label>
            {entry.type === 'boolean' ? (
              <Select id={editFieldId} value={editValue} onChange={(e) => onEditValueChange(e.target.value)} required>
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </Select>
            ) : entry.allowedValues ? (
              <Select id={editFieldId} value={editValue} onChange={(e) => onEditValueChange(e.target.value)} required>
                <option value="" disabled>Bitte wählen…</option>
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
                placeholder={entry.secret ? 'Neuen Wert eingeben' : 'Wert eingeben'}
                required
                autoFocus
              />
            )}
            {entry.validationHint && <span className="form-hint">{entry.validationHint}</span>}
          </div>
          <div className="btn-group" style={{ alignItems: 'end' }}>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Speichert…' : 'Speichern'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Abbrechen</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="settings-entry-value">
            <span className="settings-entry-value-label">Effektiver Wert</span>
            <span className="settings-entry-value-text">{formatEffectiveValue(entry)}</span>
          </div>
          {entry.pendingRestartValue !== null && entry.pendingRestartValue !== undefined && (
            <div className="settings-entry-value">
              <span className="settings-entry-value-label">Wert nach Neustart</span>
              <span className="settings-entry-value-text">
                {entry.secret ? '••••••••' : String(entry.pendingRestartValue)}
              </span>
            </div>
          )}
          <p className="settings-entry-reason">
            {entry.reason}
            {entry.uiUpdatedAt && (
              <span className="settings-entry-updated">
                {' · '}Zuletzt geändert: {formatDate(entry.uiUpdatedAt)}
                {entry.uiUpdatedBy ? ` durch ${entry.uiUpdatedBy}` : ''}
              </span>
            )}
          </p>
          <div className="btn-group">
            <Button variant="secondary" size="sm" onClick={onEdit}>Bearbeiten</Button>
            {entry.uiValuePresent && (
              <Button variant="ghost" size="sm" onClick={onReset}>Zurücksetzen</Button>
            )}
            {entry.connectivityTestable && (
              <Button variant="outline" size="sm" onClick={onTest} disabled={testState.testing}>
                {testState.testing ? 'Testet…' : 'Verbindung testen'}
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
