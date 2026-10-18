'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';
import { getApiBaseUrl } from '@/lib/runtime-config';
import { paperlessTagErrorKey } from '@/lib/paperless-tag-error';
import { isSyncActive as isSyncJobActive, syncProgressAria, type SyncJobStatus } from '@/lib/sync-progress';

const API_BASE = getApiBaseUrl();

type TagConfig = {
  policyId: string;
  paperlessTagId: number;
  paperlessTagName: string | null;
  configVersion: number;
  lastSyncedAt: string | null;
  syncStatus: 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISABLED';
  syncErrorCode: string | null;
  /** AP-22: Paperless base URL this assignment belongs to (never the token). */
  connection: string | null;
  connectionChanged: boolean;
};

type TagHit = { tagId: number; name: string };

type SyncProgress = {
  jobId: string;
  status: SyncJobStatus;
  processed: number;
  /** `null` while unknown – the bar must stay indeterminate in that case. */
  total: number | null;
  added: number;
  removed: number;
  unchanged: number;
  errorCode: string | null;
  createdAt: string | null;
  completedAt: string | null;
};

type SyncStatusResponse = {
  configured: boolean;
  lastSyncedAt?: string | null;
  syncStatus?: TagConfig['syncStatus'];
  syncErrorCode?: string | null;
  jobStatus: SyncJobStatus | null;
  progress: SyncProgress | null;
  /** AP-24 (§1.2): background schedule (only for configured policies). */
  autoSyncEnabled?: boolean;
  intervalMs?: number;
  nextSyncAt?: string | null;
};

/**
 * AP-24 (§1.2): the part of the status response that describes *when* the
 * next automatic run happens. Kept separate from `progress` because it does
 * not change while a run is in flight.
 */
type SyncSchedule = {
  autoSyncEnabled: boolean;
  intervalMs: number;
  nextSyncAt: string | null;
};

const toSyncSchedule = (data: SyncStatusResponse): SyncSchedule | null =>
  data.autoSyncEnabled === undefined
    ? null
    : {
        autoSyncEnabled: data.autoSyncEnabled,
        intervalMs: data.intervalMs ?? 0,
        nextSyncAt: data.nextSyncAt ?? null,
      };

type SyncStartResponse = {
  jobId: string;
  status: SyncJobStatus;
  configVersion: number;
  alreadyRunning: boolean;
};

/** Poll cadence: fast enough to feel immediate, slow enough to stay cheap. */
const SYNC_POLL_INTERVAL_MS = 1000;

/** Give up after this many consecutive failed status requests. */
const MAX_POLL_FAILURES = 5;

const progressStatusKey = (status: SyncJobStatus): string => {
  switch (status) {
    case 'QUEUED':
      return 'policies.paperlessTagProgressQUEUED';
    case 'RUNNING':
      return 'policies.paperlessTagProgressRUNNING';
    case 'SUCCEEDED':
      return 'policies.paperlessTagProgressSUCCEEDED';
    default:
      return 'policies.paperlessTagProgressFAILED';
  }
};

/**
 * AP-22: "Paperless-ngx-Dokumentzuordnung" section inside the policy's
 * **Documents** tab (the tag decides which documents appear there, so the
 * control lives where its effect is visible). Lets the user search/select an
 * existing tag, create a new one after an explicit confirmation, change or
 * remove the assignment, trigger an immediate sync and see the last
 * successful sync plus error state.
 *
 * `onConfigChange` lets the parent refresh data that depends on the
 * assignment (e.g. the hint which tag a manual link will receive).
 */
export default function PaperlessTagSection({
  policyId,
  insurerName,
  onConfigChange,
  onDocumentsChanged,
}: {
  policyId: string;
  insurerName: string;
  onConfigChange?: () => void;
  /**
   * AP-24 (§1.1): called after a successful reconciliation so the parent can
   * refresh ONLY the document list (query/router level) – a full page reload
   * would throw away scroll position, filters and unsaved input.
   */
  onDocumentsChanged?: () => void;
}): ReactElement {
  const { t } = useI18n();
  const [config, setConfig] = useState<TagConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TagHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  // AP-24 (§1.1): progress of the last/running manual reconciliation.
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  // AP-24 (§1.2): last/next scheduled background run as reported by the API.
  const [schedule, setSchedule] = useState<SyncSchedule | null>(null);
  /** AP-24 (§1.1): a run is queued or running – the trigger stays disabled. */
  const syncActive = isSyncJobActive(progress?.status);

  const seq = useRef(0);
  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingRef = useRef(false);

  const loadConfig = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/paperless-tag`,
        { credentials: 'include' },
      );
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error(t('policies.paperlessTagLoadError'));
      const data = await res.json().catch(() => null);
      if (mySeq === seq.current) setConfig(data ?? null);
    } catch {
      if (mySeq === seq.current) setError(t('policies.paperlessTagLoadError'));
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [policyId, t]);

  const statusUrl = `${API_BASE}/households/default/policies/${policyId}/paperless-tag/status`;

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // AP-24 (§1.1): polls the status endpoint until the run reaches a terminal
  // state. Every exit path (terminal state, unmount, policy change) goes
  // through `stopPolling`, so no timer can outlive the component or keep
  // polling for another insurance.
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    let failures = 0;

    const tick = async () => {
      if (!pollingRef.current) return;
      let next: SyncStatusResponse | null = null;
      let failed = false;
      try {
        const res = await fetch(statusUrl, { credentials: 'include' });
        if (!pollingRef.current) return;
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        next = (await res.json()) as SyncStatusResponse;
      } catch {
        failed = true;
      }
      if (!pollingRef.current) return;

      if (failed || !next) {
        // Transient network problem: keep the last known state and retry a
        // bounded number of times instead of polling forever.
        failures += 1;
        if (failures > MAX_POLL_FAILURES) {
          stopPolling();
          setError(t('policies.paperlessTagLoadError'));
          return;
        }
      } else {
        failures = 0;
        if (next.progress) setProgress(next.progress);
        const nextSchedule = toSyncSchedule(next);
        if (nextSchedule) setSchedule(nextSchedule);
        if (!next.jobStatus || next.jobStatus === 'SUCCEEDED' || next.jobStatus === 'FAILED') {
          const outcome = next.jobStatus;
          stopPolling();
          if (outcome === 'SUCCEEDED') {
            // Reload only the configuration (last successful sync) and let the
            // parent refresh the document list – never a full page reload.
            await loadConfig();
            setNotice(t('policies.paperlessTagProgressListRefreshed'));
            onDocumentsChanged?.();
          } else if (outcome === 'FAILED') {
            await loadConfig();
            setNotice(null);
            setError(t('policies.paperlessTagProgressFAILED'));
          }
          return;
        }
      }

      pollRef.current = setTimeout(() => void tick(), SYNC_POLL_INTERVAL_MS);
    };

    void tick();
  }, [statusUrl, stopPolling, t, loadConfig, onDocumentsChanged]);

  // AP-24 (§1.1): pick up a run that is still active after a page reload, and
  // guarantee that leaving the page stops the polling.
  useEffect(() => {
    let cancelled = false;
    const resume = async () => {
      try {
        const res = await fetch(statusUrl, { credentials: 'include' });
        if (cancelled || res.status === 401 || !res.ok) return;
        const data = (await res.json()) as SyncStatusResponse;
        if (cancelled) return;
        if (data.progress) setProgress(data.progress);
        const nextSchedule = toSyncSchedule(data);
        if (nextSchedule) setSchedule(nextSchedule);
        if (data.jobStatus === 'QUEUED' || data.jobStatus === 'RUNNING') startPolling();
      } catch {
        // Status is best-effort: a failed resume must not break the section.
      }
    };
    void resume();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [statusUrl, startPolling, stopPolling]);

  useEffect(() => {
    setEditing(false);
    setSearch('');
    setResults(null);
    setSearchError(null);
    setError(null);
    setNotice(null);
    // AP-24 (§1.2): never show the previous insurance' schedule here.
    setSchedule(null);
    void loadConfig();
    return () => {
      seq.current += 1;
      searchSeq.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [policyId, loadConfig]);

  // Debounced server-side tag search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = search.trim();
    if (!editing || term.length < 2) {
      // No request will be made: clear the spinner as well, otherwise it stays
      // visible forever after the term is shortened below the minimum length.
      // Bumping the sequence invalidates an in-flight search, so a late answer
      // cannot render hits under a term the user already cleared.
      searchSeq.current += 1;
      setSearching(false);
      setResults(null);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    debounceRef.current = setTimeout(async () => {
      const mySeq = ++searchSeq.current;
      try {
        const res = await fetch(
          `${API_BASE}/households/default/paperless-tags?search=${encodeURIComponent(term)}`,
          { credentials: 'include' },
        );
        if (mySeq !== searchSeq.current) return;
        if (!res.ok) {
          // AP-22 follow-up: the API names the cause – showing "no results"
          // for an unreachable/broken Paperless would be misleading.
          const body = await res.json().catch(() => null);
          if (mySeq !== searchSeq.current) return;
          setSearchError(
            t(paperlessTagErrorKey(body, 'policies.paperlessTagSearchError')),
          );
          setResults([]);
          return;
        }
        const data = await res.json();
        if (mySeq === searchSeq.current) setResults(data.items ?? []);
      } catch {
        if (mySeq === searchSeq.current) {
          setSearchError(t('policies.paperlessTagSearchError'));
          setResults([]);
        }
      } finally {
        if (mySeq === searchSeq.current) setSearching(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, editing, t]);

  const statusLabel = (status: TagConfig['syncStatus']): string => {
    switch (status) {
      case 'ACTIVE':
        return t('policies.paperlessTagStatusACTIVE');
      case 'ERROR':
        return t('policies.paperlessTagStatusERROR');
      default:
        return t('policies.paperlessTagStatusPENDING');
    }
  };

  const errorLabel = (code: string | null): string => {
    switch (code) {
      case 'NOT_FOUND':
      case 'TAG_DELETED':
        return t('policies.paperlessTagErrorTAG_DELETED');
      case 'AUTH_FAILED':
        return t('policies.paperlessTagErrorAUTH_FAILED');
      case 'NOT_CONFIGURED':
        return t('policies.paperlessTagErrorNOT_CONFIGURED');
      case 'UNREACHABLE':
        return t('policies.paperlessTagErrorUNREACHABLE');
      case 'SYNC_FAILED':
        return t('policies.paperlessTagErrorSYNC_FAILED');
      case 'CONNECTION_CHANGED':
        return t('policies.paperlessTagErrorCONNECTION_CHANGED');
      default:
        return t('policies.paperlessTagErrorUnknown');
    }
  };

  const assignTag = async (tagId: number, tagName?: string) => {
    const mySeq = seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/paperless-tag`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagId, tagName }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // AP-22: translate the API error code like the search and create
        // paths do - a raw technical string must never reach the UI.
        throw new Error(t(paperlessTagErrorKey(data, 'policies.paperlessTagSaveError')));
      }
      if (mySeq === seq.current) {
        setEditing(false);
        setSearch('');
        setResults(null);
        setNewTagName('');
        await loadConfig();
        // AP-22: the Documents tab shows which tag a manual link will add.
        onConfigChange?.();
      }
    } catch (err) {
      if (mySeq === seq.current) {
        setError(err instanceof Error ? err.message : t('policies.paperlessTagSaveError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const mySeq = seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/households/default/paperless-tags`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // AP-22: turn the API error code into a concrete explanation
        // (not configured / access denied / not reachable / rejected).
        throw new Error(t(paperlessTagErrorKey(data, 'policies.paperlessTagSaveError')));
      }
      const tag = (await res.json()) as TagHit;
      if (mySeq === seq.current) await assignTag(tag.tagId, tag.name);
    } catch (err) {
      if (mySeq === seq.current) {
        setError(err instanceof Error ? err.message : t('policies.paperlessTagSaveError'));
      }
      setBusy(false);
    }
  };

  const removeTag = async () => {
    if (!window.confirm(t('policies.paperlessTagRemoveConfirm'))) return;
    const mySeq = seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/paperless-tag`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('policies.paperlessTagSaveError'));
      if (mySeq === seq.current) {
        await loadConfig();
        // AP-22: the Documents tab shows which tag a manual link will add.
        onConfigChange?.();
      }
    } catch (err) {
      if (mySeq === seq.current) {
        setError(err instanceof Error ? err.message : t('policies.paperlessTagSaveError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const refreshNow = async () => {
    const mySeq = seq.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/paperless-tag/sync`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('policies.paperlessTagLoadError'));
      const data = (await res.json().catch(() => null)) as SyncStartResponse | null;
      if (mySeq === seq.current) {
        setNotice(
          data?.alreadyRunning
            ? t('policies.paperlessTagSyncAlreadyRunning')
            : t('policies.paperlessTagSyncQueued'),
        );
        // Show the queued state immediately instead of waiting for the first
        // poll – the acceptance criterion is visible progress shortly after
        // the start.
        setProgress({
          jobId: data?.jobId ?? '',
          status: data?.status ?? 'QUEUED',
          processed: 0,
          total: null,
          added: 0,
          removed: 0,
          unchanged: 0,
          errorCode: null,
          createdAt: null,
          completedAt: null,
        });
        startPolling();
        await loadConfig();
      }
    } catch (err) {
      if (mySeq === seq.current) {
        setError(err instanceof Error ? err.message : t('policies.paperlessTagLoadError'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ maxWidth: 720, marginTop: 'var(--versigo-space-4)' }}>
      <h2>{t('policies.paperlessTagTitle')}</h2>
      <p className="text-sm text-muted" style={{ margin: 'var(--versigo-space-2) 0 var(--versigo-space-4)' }}>
        {t('policies.paperlessTagBody')}
      </p>

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && (
        <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
          <Alert variant="success">{notice}</Alert>
        </div>
      )}

      {/* AP-24 (§1.1): live progress of the manual reconciliation. The status
          text is the aria-live region; the bar only shows a percentage when
          the total is known, otherwise it stays deliberately indeterminate. */}
      {progress && (
        <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
          <div aria-live="polite" className="text-sm">
            {t(progressStatusKey(progress.status))}
          </div>
          {(() => {
            const aria = syncProgressAria(progress);
            const valueText = aria.determinate
              ? t('policies.paperlessTagProgressOf', {
                  processed: progress.processed,
                  total: progress.total ?? 0,
                })
              : t('policies.paperlessTagProgressIndeterminate', {
                  processed: progress.processed,
                });
            return (
              <>
                <div
                  className="sync-progress"
                  role="progressbar"
                  aria-label={t('policies.paperlessTagProgressLabel')}
                  aria-valuemin={0}
                  aria-valuemax={aria.ariaValuemax}
                  aria-valuenow={aria.ariaValuenow}
                  aria-valuetext={valueText}
                  style={{ marginTop: 'var(--versigo-space-2)' }}
                >
                  {aria.determinate ? (
                    <div className="sync-progress-fill" style={{ width: `${aria.percent}%` }} />
                  ) : (
                    <div className="sync-progress-indeterminate" />
                  )}
                </div>
                <div
                  className="text-xs text-muted"
                  style={{ marginTop: 'var(--versigo-space-1)' }}
                >
                  {valueText}
                  {' · '}
                  {t('policies.paperlessTagProgressChanges', {
                    added: progress.added,
                    removed: progress.removed,
                    unchanged: progress.unchanged,
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--versigo-space-6)' }}>
          <InlineSpinner />
        </div>
      ) : config ? (
        <div style={{ display: 'grid', gap: 'var(--versigo-space-3)' }}>
          <div>
            <strong>{t('policies.paperlessTagSelected')}: </strong>
            {config.paperlessTagName ?? `#${config.paperlessTagId}`}
            <span className="text-xs text-muted"> ({t('policies.paperlessTagId')}: {config.paperlessTagId})</span>
          </div>
          <div className="text-sm text-muted">
            {t('policies.paperlessTagConnection')}:{' '}
            {config.connection ?? t('policies.paperlessTagConnectionUnknown')}
          </div>
          {config.connectionChanged && (
            <Alert variant="warning">{t('policies.paperlessTagConnectionChanged')}</Alert>
          )}
          <div className="text-sm text-muted">
            {t('policies.paperlessTagLastSync')}:{' '}
            {config.lastSyncedAt
              ? new Date(config.lastSyncedAt).toLocaleString()
              : t('policies.paperlessTagNeverSynced')}
            {' · '}
            {statusLabel(config.syncStatus)}
          </div>
          {/* AP-24 (§1.2): next scheduled background run – or an explicit hint
              that the automatic sync has been switched off by an admin. */}
          {schedule && (
            <div className="text-xs text-muted">
              {schedule.autoSyncEnabled
                ? schedule.nextSyncAt
                  ? t('policies.paperlessTagNextSync', {
                      date: new Date(schedule.nextSyncAt).toLocaleString(),
                    })
                  : null
                : t('policies.paperlessTagAutoSyncOff')}
            </div>
          )}
          {config.syncStatus === 'ERROR' && (
            <Alert variant="warning">{errorLabel(config.syncErrorCode)}</Alert>
          )}
          <p className="text-xs text-muted">{t('policies.paperlessTagSharedWarning')}</p>
          <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexWrap: 'wrap' }}>
            {/* AP-24 (§1.1): a running reconciliation disables the trigger – a
                second click (or a second tab) can never start a parallel run;
                the API would return the already active job anyway. */}
            <Button variant="secondary" disabled={busy || syncActive} onClick={refreshNow}>
              {busy || syncActive ? (
                <>
                  <InlineSpinner /> {t('policies.paperlessTagRefreshing')}
                </>
              ) : (
                t('policies.paperlessTagRefresh')
              )}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(true);
                setNewTagName(`VersiGo – ${insurerName}`.trim());
              }}
            >
              {t('policies.paperlessTagChange')}
            </Button>
            <Button variant="danger" disabled={busy} onClick={removeTag}>
              {t('policies.paperlessTagRemove')}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--versigo-space-3)' }}>
          <p className="text-sm text-muted">{t('policies.paperlessTagNeverSynced')}</p>
          <div>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setEditing(true);
                setNewTagName(`VersiGo – ${insurerName}`.trim());
              }}
            >
              {t('policies.paperlessTagSearchLabel')}
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div
          style={{
            marginTop: 'var(--versigo-space-4)',
            padding: 'var(--versigo-space-4)',
            background: 'var(--versigo-surface)',
            borderRadius: 'var(--versigo-radius)',
          }}
        >
          {config && <Alert variant="warning">{t('policies.paperlessTagChangeWarning')}</Alert>}
          <div style={{ marginTop: 'var(--versigo-space-3)' }}>
            <FormField label={t('policies.paperlessTagSearchLabel')} hint={t('policies.paperlessTagSearchHint')}>
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('policies.paperlessTagSearchPlaceholder')}
                autoComplete="off"
                maxLength={128}
              />
            </FormField>
          </div>

          {searching && (
            <div style={{ marginTop: 'var(--versigo-space-3)', textAlign: 'center' }}>
              <InlineSpinner />
            </div>
          )}
          {searchError && <Alert variant="danger">{searchError}</Alert>}
          {/* AP-22 follow-up: a term below the minimum length triggers no
              request at all – say why instead of showing nothing, and never
              claim "no matching tag" when no search was made. */}
          {!searching &&
            !searchError &&
            search.trim().length > 0 &&
            search.trim().length < 2 && (
              <p className="text-sm text-muted">{t('policies.paperlessTagSearchHint')}</p>
            )}
          {/* AP-22 follow-up: never claim "no matching tag" when the search
              actually failed – the error above names the cause instead. */}
          {!searching && !searchError && results !== null && results.length === 0 && (
            <p className="text-sm text-muted">{t('policies.paperlessTagNoResults')}</p>
          )}
          {results && results.length > 0 && (
            <div style={{ marginTop: 'var(--versigo-space-3)', display: 'grid', gap: 'var(--versigo-space-2)' }}>
              {results.map((hit) => (
                <div
                  key={hit.tagId}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--versigo-space-3)' }}
                >
                  <span>{hit.name}</span>
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => assignTag(hit.tagId, hit.name)}>
                    {t('policies.paperlessTagSelected')}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 'var(--versigo-space-4)', borderTop: '1px solid var(--versigo-border, #ddd)', paddingTop: 'var(--versigo-space-3)' }}>
            <strong>{t('policies.paperlessTagCreate')}</strong>
            <p className="text-xs text-muted" style={{ margin: 'var(--versigo-space-1) 0 var(--versigo-space-2)' }}>
              {t('policies.paperlessTagCreateHint')}
            </p>
            <FormField label={t('policies.paperlessTagCreateName')}>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                maxLength={128}
              />
            </FormField>
            <div style={{ marginTop: 'var(--versigo-space-2)', display: 'flex', gap: 'var(--versigo-space-2)' }}>
              <Button variant="primary" disabled={busy || !newTagName.trim()} onClick={createAndAssign}>
                {busy ? <><InlineSpinner /> {t('policies.paperlessTagCreating')}</> : t('policies.paperlessTagCreateButton')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
