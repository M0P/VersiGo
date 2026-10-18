'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Input, Select, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { documentTypeIcon, documentTypeKind, documentTypeLabelKey } from '@/lib/document-type';
import {
  ALL_DOCUMENT_CLASSES,
  DEFAULT_DOCUMENT_CLASS,
  DOCUMENT_CLASS_FILTERS,
  DOCUMENT_CLASSES,
  documentClassBadgeClass,
  documentClassFilterLabelKey,
  documentClassFilterValue,
  documentClassLabelKey,
  normalizeDocumentClass,
  pruneSelection,
  toggleSelected,
  type DocumentClass,
  type DocumentClassFilter,
} from '@/lib/document-class';
import {
  DEFAULT_DOCUMENT_SORT,
  DOCUMENT_SORT_KEYS,
  documentOriginIcon,
  documentOriginKind,
  documentOriginLabelKey,
  documentSortLabelKey,
  sortDocuments,
  type DocumentSortKey,
} from '@/lib/documents-view';
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
  // AP-24 (§2): class of this policy assignment (UNCLASSIFIED by default).
  documentClass?: string;
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

/**
 * BugFix-22: origin of a Paperless assignment as a compact icon.
 *
 * The former text badges ("Automatisch über Tag", "Manuell verlinkt", …) took
 * too much space in the list. The icon keeps the information: the accessible
 * name is the localized label and the tooltip additionally explains – for an
 * automatic assignment – why the document cannot be deleted individually.
 */
function DocumentOriginBadge({ doc }: { doc: Document }): ReactElement | null {
  const { t } = useI18n();
  const kind = documentOriginKind(doc);
  if (!kind) return null;
  const label = t(documentOriginLabelKey(kind));

  return (
    <span
      role="img"
      aria-label={label}
      title={kind === 'auto' ? t('policies.paperlessAutoManagedHint') : label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--versigo-text-muted)',
      }}
    >
      <Icon name={documentOriginIcon(kind)} size={16} />
    </span>
  );
}

/**
 * AP-24 (§2.3): class of the document assignment as a badge.
 *
 * The class is text rather than an icon because it carries an expressive
 * name ("Abrechnung", "Vertragsdokument") that is read at a glance. An
 * unknown value from an older API is shown as "Nicht klassifiziert" instead
 * of leaking the raw key.
 */
function DocumentClassBadge({ doc }: { doc: Document }): ReactElement {
  const { t } = useI18n();
  const value = normalizeDocumentClass(doc.documentClass);

  return (
    <span className={documentClassBadgeClass(value)}>
      {t(documentClassLabelKey(value))}
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
    // AP-24 (§2): documents start out unclassified unless the user picks a
    // class here.
    documentClass: DEFAULT_DOCUMENT_CLASS as string,
  });
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // BugFix-22: sort order of the list (newest first by default).
  const [sortKey, setSortKey] = useState<DocumentSortKey>(DEFAULT_DOCUMENT_SORT);
  // AP-24 (§2): class filter, bulk selection and the bulk-classify request.
  const [classFilter, setClassFilter] = useState<DocumentClassFilter>(ALL_DOCUMENT_CLASSES);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkClass, setBulkClass] = useState<DocumentClass>(DEFAULT_DOCUMENT_CLASS);
  const [classifying, setClassifying] = useState(false);
  const [classNotice, setClassNotice] = useState<string | null>(null);

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

  // AP-24 (§1.1): silent in-place refresh after a finished Paperless
  // reconciliation. Unlike `reloadDocuments` it never clears the list or
  // shows a spinner: the previous state stays visible, so scroll position,
  // filters and open sections are not disturbed while the new data arrives.
  const refreshDocumentsQuiet = async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/documents`,
        { credentials: 'include' },
      );
      if (seq !== requestSeq.current) return;
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) return; // keep the last known list
      const data = await res.json();
      if (seq === requestSeq.current) setDocuments(data);
    } catch {
      // Non-fatal: the last known list remains visible (AP-24 §1.1).
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
    setForm({ category: '', documentDate: '', documentClass: DEFAULT_DOCUMENT_CLASS });
    setFormError(null);
    setShowPaperless(false);
    setSearchTerm('');
    setPaperlessResults(null);
    setPaperlessError(null);
    setAssignedTagName(null);
    // AP-24 (§2): filter, bulk selection and notices belong to one policy.
    setClassFilter(ALL_DOCUMENT_CLASSES);
    setSelectedIds([]);
    setBulkClass(DEFAULT_DOCUMENT_CLASS);
    setClassNotice(null);
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
      // AP-24 (§2): always sent – the API default would be the same, but an
      // explicit value keeps the request self-describing.
      formData.append('documentClass', form.documentClass);

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
        setForm({ category: '', documentDate: '', documentClass: DEFAULT_DOCUMENT_CLASS });
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

  // AP-24 (§2.3): the list is loaded completely (max. 200 rows), so the class
  // filter is applied client-side – no extra request per filter change and the
  // scroll position/selection stay untouched.
  const filterValue = documentClassFilterValue(classFilter);
  const visibleDocuments = filterValue
    ? documents.filter((doc) => normalizeDocumentClass(doc.documentClass) === filterValue)
    : documents;

  // AP-24 (§2.3): a reload or a filter change must not keep IDs that are no
  // longer visible – otherwise the bulk action would reclassify documents the
  // user cannot see any more. Returning the previous array (no change) keeps
  // this from looping.
  useEffect(() => {
    setSelectedIds((prev) =>
      prev.length === 0 ? prev : pruneSelection(prev, visibleDocuments),
    );
  }, [documents, filterValue]);

  /**
   * AP-24 (§2.3): bulk reclassification. Only the selected document IDs are
   * sent; the server re-checks them against the policy, so a stale selection
   * can never touch a foreign document.
   */
  const handleBulkClassify = async () => {
    if (selectedIds.length === 0) {
      setClassNotice(t('policies.documentBulkNoneSelected'));
      return;
    }
    const seq = requestSeq.current;
    setClassifying(true);
    setClassNotice(null);
    try {
      const res = await fetch(
        `${API_BASE}/households/default/policies/${policyId}/documents/classify`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentIds: selectedIds, documentClass: bulkClass }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('common.unknownError'));
      }
      const data = await res.json().catch(() => null);
      if (seq === requestSeq.current) {
        setSelectedIds([]);
        setClassNotice(t('policies.documentBulkUpdated', { count: data?.updated ?? 0 }));
        reloadDocuments();
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setClassNotice(err instanceof Error ? err.message : t('common.unknownError'));
      }
    } finally {
      setClassifying(false);
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
              {/* AP-24 (§2): optional class right at upload; without a choice
                  the document stays "Nicht klassifiziert". */}
              <FormField label={t('policies.documentClassFilter')}>
                <Select
                  value={form.documentClass}
                  onChange={(e) => setForm({ ...form, documentClass: e.target.value })}
                >
                  {DOCUMENT_CLASSES.map((value) => (
                    <option key={value} value={value}>
                      {t(documentClassLabelKey(value))}
                    </option>
                  ))}
                </Select>
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

        {/* BugFix-22: sort by date or by name. AP-24 (§2.3): filter by class.
            `flexWrap` keeps both controls usable on a smartphone. */}
        {!loading && documents.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 'var(--versigo-space-2)',
              marginBottom: 'var(--versigo-space-3)',
            }}
          >
            <label htmlFor="documents-class" className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>
              {t('policies.documentClassFilter')}
            </label>
            <Select
              id="documents-class"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value as DocumentClassFilter)}
              style={{ maxWidth: 240 }}
            >
              {DOCUMENT_CLASS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {t(documentClassFilterLabelKey(value))}
                </option>
              ))}
            </Select>
            <label htmlFor="documents-sort" className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>
              {t('policies.documentsSort')}
            </label>
            <Select
              id="documents-sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as DocumentSortKey)}
              style={{ maxWidth: 240 }}
            >
              {DOCUMENT_SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(documentSortLabelKey(key))}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* AP-24 (§2.3): Mehrfachauswahl zum Ändern der Klasse. Der Button ist
            während eines laufenden Requests deaktiviert; eine Auswahl ist
            erforderlich, damit kein versehentliches Weiterklassifizieren
            stattfindet. */}
        {!loading && visibleDocuments.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 'var(--versigo-space-2)',
              marginBottom: 'var(--versigo-space-3)',
              padding: 'var(--versigo-space-3)',
              background: 'var(--versigo-surface)',
              borderRadius: 'var(--versigo-radius)',
            }}
          >
            <label htmlFor="documents-bulk-class" className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>
              {t('policies.documentBulkClassify')}
            </label>
            <Select
              id="documents-bulk-class"
              value={bulkClass}
              onChange={(e) => setBulkClass(e.target.value as DocumentClass)}
              style={{ maxWidth: 240 }}
            >
              {DOCUMENT_CLASSES.map((value) => (
                <option key={value} value={value}>
                  {t(documentClassLabelKey(value))}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleBulkClassify()}
              disabled={classifying || selectedIds.length === 0}
            >
              {classifying ? <><InlineSpinner /> {t('common.saving')}</> : t('common.save')}
            </Button>
            {/* aria-live: the outcome of the bulk action is announced without
                moving the focus. */}
            <span className="text-sm text-muted" aria-live="polite">
              {selectedIds.length > 0
                ? t('policies.documentBulkSelected', { count: selectedIds.length })
                : null}
            </span>
          </div>
        )}

        {classNotice && (
          <div aria-live="polite">
            <Alert variant="info">{classNotice}</Alert>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--versigo-space-8)' }}>
            <InlineSpinner />
          </div>
        ) : visibleDocuments.length === 0 ? (
          // AP-24 (§2.3): with an active class filter an empty result means
          // "no document of this class" – not "no documents at all".
          <EmptyState icon="📄" title={t('policies.noDocumentsTitle')}>
            <p>{filterValue ? t('policies.classAllEmpty') : t('policies.noDocumentsBody')}</p>
          </EmptyState>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--versigo-space-3)' }}>
            {sortDocuments(visibleDocuments, sortKey).map((doc) => (
              <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--versigo-space-3)', padding: 'var(--versigo-space-3)', background: 'var(--versigo-surface)', borderRadius: 'var(--versigo-radius)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--versigo-space-3)', minWidth: 0, flex: 1 }}>
                  {/* AP-24 (§2.3): selection for the bulk classification. The
                      visible label is the file name, so the checkbox is
                      usable with a screen reader. */}
                  <input
                    type="checkbox"
                    aria-label={doc.fileName}
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => setSelectedIds((prev) => toggleSelected(prev, doc.id))}
                    style={{ marginTop: 'var(--versigo-space-1)' }}
                  />
                  <DocumentTypeIcon mimeType={doc.mimeType} fileName={doc.fileName} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--versigo-space-2)', flexWrap: 'wrap' }}>
                      <strong style={{ wordBreak: 'break-word' }}>{doc.fileName}</strong>
                      {/* AP-24 (§2.3): class of this assignment. */}
                      <DocumentClassBadge doc={doc} />
                      {/* BugFix-22: the origin is an icon now – the former text
                          badges ("Automatisch über Tag", …) took too much space.
                          The Paperless tagging status stays a text badge because
                          it needs to be read at a glance. */}
                      <DocumentOriginBadge doc={doc} />
                      {doc.taggingStatus === 'PENDING' && (
                        <span className="badge badge-neutral">
                          {t('policies.paperlessTagPendingBadge')}
                        </span>
                      )}
                      {doc.taggingStatus === 'FAILED' && (
                        <span className="badge badge-danger">
                          {t('policies.paperlessTagFailedBadge')}
                        </span>
                      )}
                    </div>
                    {/* BugFix-22: the document date is important – it gets its
                        own line in the normal font size instead of being
                        appended to the small metadata line. */}
                    {doc.documentDate && (
                      <div
                        style={{ marginTop: 'var(--versigo-space-1)', fontSize: 'var(--versigo-font-size-base)' }}
                      >
                        {t('policies.documentDate')}:{' '}
                        <strong>{new Date(doc.documentDate).toLocaleDateString()}</strong>
                      </div>
                    )}
                    <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                      {/* BugFix-22: the Paperless deep link appears only once per
                          row – as the target of the "In Paperless öffnen" button
                          below. The full URL as text was too noisy. */}
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
                    </div>
                    {doc.taggingStatus === 'FAILED' && (
                      <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                        {t('policies.paperlessTagFailedHint')}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
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
                      misleading because the next sync would restore it.
                      BugFix-22: the explanation is the tooltip of the origin
                      icon now (see DocumentOriginBadge) instead of a wide text
                      badge in the action row. */}
                  {!(doc.linkOriginTag && !doc.linkOriginManual) && (
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
        onDocumentsChanged={refreshDocumentsQuiet}
      />
    </>
  );
}
