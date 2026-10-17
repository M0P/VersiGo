'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Input, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { documentTypeIcon, documentTypeKind, documentTypeLabelKey } from '@/lib/document-type';
import PaperlessTagSection from './paperless-tag-section';

const API_BASE = getApiBaseUrl();

type Document = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  documentDate: string | null;
  category: string | null;
  // BugFix-07 (Q3): storage type + deep link for PAPERLESS_LINK documents
  storageType?: string;
  storageRef?: string | null;
  deepLink?: string | null;
  // AP-22: independent origins + external tagging state
  linkOriginManual?: boolean;
  linkOriginTag?: boolean;
  taggingStatus?: 'PENDING' | 'APPLIED' | 'FAILED' | null;
  taggingErrorCode?: string | null;
};

// BugFix-07 (Q3): result of the Paperless search (GET /paperless/documents)
type PaperlessHit = {
  paperlessId: number;
  title: string;
  deepLink: string;
  tags: string[];
  correspondent: string | null;
};

/**
 * BugFix-21: the document type is shown as an icon instead of the raw MIME
 * type text. The icon is decorative, its accessible name carries the
 * localized type ("PDF", "Bild", …).
 */
function DocumentTypeIcon({
  mimeType,
  fileName,
}: {
  mimeType: string | null;
  fileName: string;
}): ReactElement {
  const { t } = useI18n();
  const kind = documentTypeKind(mimeType, fileName);
  const label = t(documentTypeLabelKey(kind));

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--versigo-text-muted)',
      }}
    >
      <Icon name={documentTypeIcon(kind)} size={24} />
    </span>
  );
}

export default function DocumentsTab({
  policyId,
  insurerName,
}: {
  policyId: string;
  /** AP-22: shown in the tag assignment section rendered below the list. */
  insurerName: string;
}): ReactElement {
  const { t } = useI18n();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    category: '',
    documentDate: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // BugFix-07 (Q3): Paperless linking
  const [showPaperless, setShowPaperless] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [paperlessResults, setPaperlessResults] = useState<PaperlessHit[] | null>(null);
  const [paperlessSearching, setPaperlessSearching] = useState(false);
  const [paperlessError, setPaperlessError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  // AP-22: name of the tag that a manual link will additionally receive.
  const [assignedTagName, setAssignedTagName] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared loading logic for the mount effect and handler reloads. A
  // monotonically increasing counter (`requestSeq`) invalidates in-flight
  // requests on every new load as well as on unmount/policyId change: only
  // the newest request may write state – also after submits/deletes that
  // still arrive after a policyId change (BugFix-05, finding 8: no
  // foreign-data leak from policy A under B).
  const requestSeq = useRef(0);

  const reloadDocuments = async () => {
    const seq = ++requestSeq.current;
    // BugFix-05 (finding 8): reset state so a policyId change does not
    // display documents from the previous policy.
    setDocuments([]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents`, { credentials: 'include' });
      if (seq !== requestSeq.current) return;
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.ok) {
        const data = await res.json();
        if (seq === requestSeq.current) setDocuments(data);
      } else if (seq === requestSeq.current) {
        setError(t('policies.noDocumentsBody'));
      }
    } catch {
      if (seq === requestSeq.current) setError(t('policies.noDocumentsBody'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  // AP-22: shows the user which tag a manual link will additionally receive
  // in Paperless. Failure is non-fatal – the hint is simply omitted, and a
  // failed lookup must never keep claiming a tag that may be gone. `tagSeq`
  // invalidates an in-flight lookup after a policyId change, so a late answer
  // for the previous policy cannot overwrite the current hint.
  const tagSeq = useRef(0);
  const loadAssignedTag = async () => {
    const seq = ++tagSeq.current;
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/paperless-tag`,
        { credentials: 'include' },
      );
      if (seq !== tagSeq.current) return;
      if (!res.ok) {
        setAssignedTagName(null);
        return;
      }
      const data = await res.json();
      if (seq === tagSeq.current) setAssignedTagName(data?.paperlessTagName ?? null);
    } catch {
      if (seq === tagSeq.current) setAssignedTagName(null);
    }
  };

  // BugFix-05 (finding 4): reload on mount and on every policyId change –
  // otherwise the spinner stays stuck (empty list) or documents from the
  // previous policy are shown. The cleanup invalidates in-flight requests
  // of the previous policyId / after unmount (no state updates afterwards).
  // BugFix-05 (finding 8): the form is also reset on a policyId change – an
  // open form holding data of policy A must not remain under B (a later
  // upload error would otherwise render under B or the fields of A would
  // stay visible).
  useEffect(() => {
    setShowForm(false);
    setFile(null);
    setForm({ category: '', documentDate: '' });
    setFormError(null);
    setShowPaperless(false);
    setSearchTerm('');
    setPaperlessResults(null);
    setPaperlessError(null);
    setAssignedTagName(null);
    void reloadDocuments();
    void loadAssignedTag();
    // policyId controls the data source; `t` is deliberately not in the
    // dependencies (a language switch must not reload the list).
    return () => {
      requestSeq.current += 1;
      searchSeq.current += 1;
      tagSeq.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [policyId]);

  // BugFix-07 (Q3): debounced live search in Paperless. An empty search
  // term (or < 2 characters) triggers no request; a policyId change
  // invalidates in-flight searches via searchSeq.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = searchTerm.trim();
    if (!showPaperless || term.length < 2) {
      setPaperlessResults(null);
      return;
    }
    setPaperlessSearching(true);
    setPaperlessError(null);
    debounceRef.current = setTimeout(async () => {
      const seq = searchSeq.current;
      try {
        const res = await fetch(`${API_BASE}/paperless/documents?search=${encodeURIComponent(term)}`, { credentials: 'include' });
        if (seq !== searchSeq.current) return;
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (res.ok) {
          const data: PaperlessHit[] = await res.json();
          if (seq === searchSeq.current) setPaperlessResults(data);
        } else if (seq === searchSeq.current) {
          setPaperlessError(t('policies.paperlessSearchError'));
          setPaperlessResults([]);
        }
      } catch {
        if (seq === searchSeq.current) {
          setPaperlessError(t('policies.paperlessSearchError'));
          setPaperlessResults([]);
        }
      } finally {
        if (seq === searchSeq.current) setPaperlessSearching(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchTerm, showPaperless, t]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFormError(t('policies.documentFile') + ' ' + t('common.required'));
      return;
    }
    // BugFix-05 (finding 8): seq token like on reload/delete – an upload
    // error of an older request must not render an error message in the
    // (already reset) form of the new policy after a policyId change. The
    // success path runs through reloadDocuments(), which sets a new seq itself.
    const seq = requestSeq.current;
    setFormError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (form.category) formData.append('category', form.category);
      if (form.documentDate) formData.append('documentDate', form.documentDate);

      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('common.unknownError'));
      }
      // BugFix-05 (finding 8, review round 5): the form-reset writes are
      // also seq-guarded – a late success of an upload from A must not
      // close/clear B's open form after a policyId change.
      if (seq === requestSeq.current) {
        setFile(null);
        setForm({ category: '', documentDate: '' });
        setShowForm(false);
        // Success reload only if no policyId change happened in the meantime
        // – otherwise the stale closure would load policy A's documents
        // under B. The new policyId effect already loads B itself.
        reloadDocuments();
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setFormError(err instanceof Error ? err.message : t('common.unknownError'));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleLinkPaperless = async (paperlessId: number) => {
    const seq = requestSeq.current;
    setLinkingId(paperlessId);
    setPaperlessError(null);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents/paperless`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperlessDocumentId: paperlessId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('common.unknownError'));
      }
      // Deduplication is idempotent: the already-linked document is
      // returned again – after the reload it appears with the
      // "already linked" badge where applicable.
      if (seq === requestSeq.current) {
        setPaperlessResults((prev) => prev?.filter((r) => r.paperlessId !== paperlessId) ?? null);
        reloadDocuments();
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setPaperlessError(err instanceof Error ? err.message : t('common.unknownError'));
      }
    } finally {
      setLinkingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    // AP-22: the confirmation explains the consequences depending on the
    // assignment origins (automatic documentation stays tag-controlled).
    const confirmMessage =
      doc?.linkOriginTag && doc?.linkOriginManual
        ? t('policies.paperlessDeleteBothConfirm')
        : doc?.linkOriginTag
          ? t('policies.paperlessDeleteAutoConfirm')
          : doc?.linkOriginManual
            ? t('policies.paperlessDeleteManualConfirm')
            : t('policies.confirmDeleteDocument');
    if (!window.confirm(confirmMessage)) return;
    // BugFix-05 (finding 8): seq token like on reload – an error of an
    // older request must not render an error message under the new policy.
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.unknownError'));
      // BugFix-05 (finding 8, review round 4): the success reload is also
      // seq-guarded – after a policyId change the stale closure must not
      // load policy A's documents under B.
      if (seq === requestSeq.current) reloadDocuments();
    } catch {
      if (seq === requestSeq.current) setError(t('common.unknownError'));
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isLinked = (doc: Document): boolean => doc.storageType === 'PAPERLESS_LINK';

  // AP-22: origin label for a document (automatic / manual / both).
  const originLabel = (doc: Document): string | null => {
    if (doc.linkOriginTag && doc.linkOriginManual) return t('policies.paperlessOriginBoth');
    if (doc.linkOriginTag) return t('policies.paperlessOriginAuto');
    if (doc.linkOriginManual) return t('policies.paperlessOriginManual');
    return null;
  };

  const handleRetryTagging = async (id: string) => {
    const seq = requestSeq.current;
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/paperless-tag/retry`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: id }),
        },
      );
      if (!res.ok) throw new Error(t('common.unknownError'));
      if (seq === requestSeq.current) reloadDocuments();
    } catch {
      if (seq === requestSeq.current) setError(t('common.unknownError'));
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
          <h2>{t('policies.tabs.documents')}</h2>
          <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
            {/* BugFix-07 (Q3): Paperless linking – separate panel so any
                number of documents can be linked one after another. */}
            <Button variant="secondary" onClick={() => setShowPaperless((v) => !v)}>
              {t('policies.paperlessConnect')}
            </Button>
            <Button variant="primary" onClick={() => setShowForm(true)}>
              {t('policies.uploadDocument')}
            </Button>
          </div>
        </div>

        {showPaperless && (
          <div style={{ marginBottom: 'var(--versigo-space-6)', padding: 'var(--versigo-space-4)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
            <strong>{t('policies.paperlessConnectTitle')}</strong>
            <p className="text-sm text-muted" style={{ margin: 'var(--versigo-space-2) 0 var(--versigo-space-4)' }}>
              {t('policies.paperlessConnectBody')}
            </p>
            {/* AP-22: tell the user which tag the manual link will add. */}
            {assignedTagName && (
              <Alert variant="info">
                {t('policies.paperlessLinkAddsTag', { tag: assignedTagName })}
              </Alert>
            )}
            <FormField label={t('policies.paperlessSearchPlaceholder')} hint={t('policies.paperlessSearchHint')}>
              <Input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('policies.paperlessSearchPlaceholder')}
                autoComplete="off"
                maxLength={200}
              />
            </FormField>

            {paperlessError && (
              <div style={{ marginTop: 'var(--versigo-space-3)' }}>
                <Alert variant="danger">{paperlessError}</Alert>
              </div>
            )}

            {paperlessSearching && (
              <div style={{ marginTop: 'var(--versigo-space-4)', textAlign: 'center' }}>
                <InlineSpinner />
              </div>
            )}

            {!paperlessSearching && paperlessResults !== null && paperlessResults.length === 0 && searchTerm.trim().length >= 2 && (
              <p className="text-sm text-muted" style={{ marginTop: 'var(--versigo-space-4)' }}>
                {t('policies.paperlessNoResults')}
              </p>
            )}

            {paperlessResults && paperlessResults.length > 0 && (
              <div style={{ marginTop: 'var(--versigo-space-4)', display: 'grid', gap: 'var(--versigo-space-3)' }}>
                {paperlessResults.map((hit) => (
                  <div key={hit.paperlessId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--versigo-space-3)', padding: 'var(--versigo-space-3)', background: 'var(--versigo-surface-alt, var(--versigo-surface))', borderRadius: 'var(--versigo-radius)' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{hit.title}</strong>
                      {hit.correspondent && (
                        <div className="text-xs text-muted">{hit.correspondent}</div>
                      )}
                      {hit.tags.length > 0 && (
                        <div className="text-xs text-muted">{hit.tags.join(', ')}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexShrink: 0 }}>
                      <a href={hit.deepLink} target="_blank" rel="noopener noreferrer">
                        <Button variant="secondary" size="sm">{t('policies.paperlessOpenInPaperless')}</Button>
                      </a>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={linkingId === hit.paperlessId}
                        onClick={() => handleLinkPaperless(hit.paperlessId)}
                      >
                        {linkingId === hit.paperlessId ? <><InlineSpinner /> {t('policies.paperlessConnecting')}</> : t('policies.paperlessConnectButton')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} style={{ marginBottom: 'var(--versigo-space-6)', padding: 'var(--versigo-space-4)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--versigo-space-4)' }}>
              <FormField label={t('policies.documentFile')} required>
                <Input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              </FormField>
              <FormField label={t('policies.documentCategory')}>
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder={t('policies.documentCategoryPlaceholder')}
                />
              </FormField>
              <FormField label={t('policies.documentDate')}>
                <Input
                  type="date"
                  value={form.documentDate}
                  onChange={(e) => setForm({ ...form, documentDate: e.target.value })}
                />
              </FormField>
            </div>
            {formError && (
              <div style={{ marginTop: 'var(--versigo-space-3)' }}>
                <Alert variant="danger">{formError}</Alert>
              </div>
            )}
            <div style={{ marginTop: 'var(--versigo-space-4)', display: 'flex', gap: 'var(--versigo-space-2)' }}>
              <Button type="submit" disabled={uploading}>
                {uploading ? <><InlineSpinner /> {t('common.saving')}</> : t('common.save')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setFile(null); setFormError(null); }}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}

        {error && <Alert variant="danger">{error}</Alert>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--versigo-space-8)' }}>
            <InlineSpinner />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState icon="📄" title={t('policies.noDocumentsTitle')}>
            <p>{t('policies.noDocumentsBody')}</p>
          </EmptyState>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--versigo-space-3)' }}>
            {documents.map((doc) => (
              <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--versigo-space-3)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--versigo-space-3)' }}>
                  <DocumentTypeIcon mimeType={doc.mimeType} fileName={doc.fileName} />
                  <div>
                    <strong>{doc.fileName}</strong>
                    {/* AP-22: origin + external tagging status */}
                    {originLabel(doc) && (
                      <span
                        className="badge badge-neutral"
                        style={{ marginLeft: 'var(--versigo-space-2)' }}
                      >
                        {originLabel(doc)}
                      </span>
                    )}
                    {doc.taggingStatus === 'PENDING' && (
                      <span
                        className="badge badge-neutral"
                        style={{ marginLeft: 'var(--versigo-space-2)' }}
                      >
                        {t('policies.paperlessTagPendingBadge')}
                      </span>
                    )}
                    {doc.taggingStatus === 'FAILED' && (
                      <span
                        className="badge badge-danger"
                        style={{ marginLeft: 'var(--versigo-space-2)' }}
                      >
                        {t('policies.paperlessTagFailedBadge')}
                      </span>
                    )}
                    <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                      {isLinked(doc) ? (
                        <>
                          {t('policies.paperlessLinkedDocument')}
                          {doc.category && ` · ${doc.category}`}
                        </>
                      ) : (
                        <>
                          {formatFileSize(doc.fileSize)}
                          {doc.category && ` · ${t('policies.documentCategory')}: ${doc.category}`}
                        </>
                      )}
                      {doc.documentDate && ` · ${t('policies.documentDate')}: ${new Date(doc.documentDate).toLocaleDateString()}`}
                      {/* BugFix-21: the URL of the document in Paperless.
                          The upload timestamp is intentionally not shown. */}
                      {isLinked(doc) && doc.deepLink && (
                        <>
                          {' · '}
                          <a
                            href={doc.deepLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t('policies.paperlessOpenInPaperless')}
                            style={{ wordBreak: 'break-all' }}
                          >
                            {doc.deepLink}
                          </a>
                        </>
                      )}
                    </div>
                    {doc.taggingStatus === 'FAILED' && (
                      <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                        {t('policies.paperlessTagFailedHint')}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {/* BugFix-07 (Q3): PAPERLESS_LINK documents have no
                      local file content – instead of preview/download the
                      Paperless deep link is offered.
                      BugFix-21: without a deep link no second
                      "Paperless-Dokument" badge is rendered – the metadata
                      line above already names the document type. */}
                  {isLinked(doc) ? (
                    doc.deepLink ? (
                      <a href={doc.deepLink} target="_blank" rel="noopener noreferrer">
                        <Button variant="secondary" size="sm">{t('policies.paperlessOpenInPaperless')}</Button>
                      </a>
                    ) : null
                  ) : (
                    <>
                      <a href={`${API_BASE}/households/default/policies/${policyId}/documents/${doc.id}/preview`} target="_blank" rel="noopener noreferrer">
                        <Button variant="secondary" size="sm">{t('policies.previewDocument')}</Button>
                      </a>
                      <a href={`${API_BASE}/households/default/policies/${policyId}/documents/${doc.id}/download`}>
                        <Button variant="secondary" size="sm">{t('policies.downloadDocument')}</Button>
                      </a>
                    </>
                  )}
                  {doc.taggingStatus === 'FAILED' && (
                    <Button variant="secondary" size="sm" onClick={() => handleRetryTagging(doc.id)}>
                      {t('policies.paperlessTagRetry')}
                    </Button>
                  )}
                  {/* AP-22: an exclusively automatic assignment is controlled by
                      the Paperless tag; offering "delete" here would be
                      misleading because the next sync would restore it. */}
                  {doc.linkOriginTag && !doc.linkOriginManual ? (
                    <span className="badge badge-neutral" style={{ alignSelf: 'center' }}>
                      {t('policies.paperlessAutoManagedHint')}
                    </span>
                  ) : (
                    <Button variant="danger" size="sm" onClick={() => handleDelete(doc.id)}>{t('policies.deleteDocument')}</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* AP-22: the tag decides which Paperless documents appear in this tab,
          so its management lives here instead of the policy's basic settings. */}
      <PaperlessTagSection
        policyId={policyId}
        insurerName={insurerName}
        onConfigChange={loadAssignedTag}
      />
    </>
  );
}
