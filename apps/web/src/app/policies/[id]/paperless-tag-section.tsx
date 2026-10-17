'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';
import { getApiBaseUrl } from '@/lib/runtime-config';

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

/**
 * AP-22: "Paperless-ngx-Dokumentzuordnung" section on the policy edit page.
 * Lets the user search/select an existing tag, create a new one after an
 * explicit confirmation, change or remove the assignment, trigger an
 * immediate sync and see the last successful sync plus error state.
 */
export default function PaperlessTagSection({
  policyId,
  insurerName,
}: {
  policyId: string;
  insurerName: string;
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

  const seq = useRef(0);
  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    setEditing(false);
    setSearch('');
    setResults(null);
    setSearchError(null);
    setError(null);
    setNotice(null);
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
      setSearching(false);
      setResults(null);
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
          setSearchError(t('policies.paperlessTagSearchError'));
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
        throw new Error(data?.message ?? t('policies.paperlessTagSaveError'));
      }
      if (mySeq === seq.current) {
        setEditing(false);
        setSearch('');
        setResults(null);
        setNewTagName('');
        await loadConfig();
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
        throw new Error(data?.message ?? t('policies.paperlessTagSaveError'));
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
      if (mySeq === seq.current) await loadConfig();
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
      if (mySeq === seq.current) {
        setNotice(t('policies.paperlessTagSyncQueued'));
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
          {config.syncStatus === 'ERROR' && (
            <Alert variant="warning">{errorLabel(config.syncErrorCode)}</Alert>
          )}
          <p className="text-xs text-muted">{t('policies.paperlessTagSharedWarning')}</p>
          <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexWrap: 'wrap' }}>
            <Button variant="secondary" disabled={busy} onClick={refreshNow}>
              {busy ? <><InlineSpinner /> {t('policies.paperlessTagRefreshing')}</> : t('policies.paperlessTagRefresh')}
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
          {!searching && results !== null && results.length === 0 && (
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
