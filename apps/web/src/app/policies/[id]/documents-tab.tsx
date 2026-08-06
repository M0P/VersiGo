'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type Document = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  documentDate: string | null;
  category: string | null;
  uploadedAt: string;
  // BugFix-07 (Q3): Storage-Art + Deep-Link fuer PAPERLESS_LINK-Dokumente
  storageType?: string;
  storageRef?: string | null;
  deepLink?: string | null;
};

// BugFix-07 (Q3): Ergebnis der Paperless-Suche (GET /paperless/documents)
type PaperlessHit = {
  paperlessId: number;
  title: string;
  deepLink: string;
  tags: string[];
  correspondent: string | null;
};

export default function DocumentsTab({ policyId }: { policyId: string }): ReactElement {
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

  // BugFix-07 (Q3): Paperless-Verknuepfung
  const [showPaperless, setShowPaperless] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [paperlessResults, setPaperlessResults] = useState<PaperlessHit[] | null>(null);
  const [paperlessSearching, setPaperlessSearching] = useState(false);
  const [paperlessError, setPaperlessError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gemeinsame Ladelogik fuer Mount-Effekt und Handler-Reloads. Ein
  // Monoton-zaehler (`requestSeq`) invalidiert in-flight Requests bei jedem
  // neuen Ladevorgang sowie bei Unmount/policyId-Wechsel: Nur die neueste
  // Anfrage darf Zustand schreiben – auch nach Submits/Deletes, die nach
  // einem policyId-Wechsel noch eintreffen (BugFix-05, Befund 8: kein
  // Fremddaten-Leak von Versicherung A unter B).
  const requestSeq = useRef(0);

  const reloadDocuments = async () => {
    const seq = ++requestSeq.current;
    // BugFix-05 (Befund 8): State zuruecksetzen, damit beim policyId-Wechsel
    // keine Dokumente der vorherigen Versicherung angezeigt werden.
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

  // BugFix-05 (Befund 4): Beim Mount und bei jedem policyId-Wechsel neu laden –
  // sonst bleibt der Spinner haengen (leere Liste) bzw. es erscheinen Dokumente
  // der vorherigen Versicherung. Der Cleanup invalidiert in-flight Requests des
  // vorherigen policyId bzw. nach Unmount (keine Zustands-Updates danach).
  // BugFix-05 (Befund 8): Beim policyId-Wechsel wird auch das Formular
  // zurueckgesetzt – ein offenes Formular mit Daten der Versicherung A darf
  // nicht unter B stehen bleiben (ein spaeterer Upload-Fehler wuerde sonst
  // unter B gerendert bzw. die Felder von A weiterhin anzeigen).
  useEffect(() => {
    setShowForm(false);
    setFile(null);
    setForm({ category: '', documentDate: '' });
    setFormError(null);
    setShowPaperless(false);
    setSearchTerm('');
    setPaperlessResults(null);
    setPaperlessError(null);
    void reloadDocuments();
    // policyId steuert die Datenquelle; t ist bewusst nicht in den Dependencies
    // (Sprachwechsel soll die Liste nicht neu laden).
    return () => {
      requestSeq.current += 1;
      searchSeq.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [policyId]);

  // BugFix-07 (Q3): Debounced Live-Suche in Paperless. Leerer Suchbegriff
  // (oder < 2 Zeichen) loest keine Anfrage aus; ein policyId-Wechsel
  // invalidiert in-flight Suchen ueber searchSeq.
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
    // BugFix-05 (Befund 8): Seq-Token wie beim Reload/Delete – ein Upload-
    // Fehler einer aelteren Anfrage darf nach policyId-Wechsel keine
    // Fehlermeldung im (bereits zurueckgesetzten) Formular der neuen
    // Versicherung rendern. Der Erfolgspfad laeuft ueber reloadDocuments(),
    // das selbst einen neuen Seq-Stand setzt.
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
      // BugFix-05 (Befund 8, Review-Runde 5): Auch die Formular-Reset-Writes
      // sind seq-gesichert – ein spaeter Erfolg eines Uploads von A darf nach
      // policyId-Wechsel nicht B's offenes Formular schliessen/leeren.
      if (seq === requestSeq.current) {
        setFile(null);
        setForm({ category: '', documentDate: '' });
        setShowForm(false);
        // Erfolgs-Reload nur, wenn kein policyId-Wechsel zwischenzeitlich
        // stattfand – sonst wuerde die veraltete Closure Dokumente von A unter
        // B laden. Der neue policyId-Effekt laedt B bereits selbst.
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
      // Deduplizierung ist idempotent: Das bereits verbundene Dokument wird
      // erneut zurueckgegeben – nach dem Reload erscheint es ggf. mit dem
      // "Bereits verbunden"-Badge.
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
    if (!window.confirm(t('policies.confirmDeleteDocument'))) return;
    // BugFix-05 (Befund 8): Seq-Token wie beim Reload – ein Fehler einer
    // aelteren Anfrage darf nach policyId-Wechsel keine Fehlermeldung unter
    // der neuen Versicherung rendern.
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.unknownError'));
      // BugFix-05 (Befund 8, Review-Runde 4): Auch der Erfolgs-Reload ist
      // seq-gesichert – nach einem policyId-Wechsel darf die veraltete Closure
      // keine Dokumente von A unter B laden.
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

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
        <h2>{t('policies.tabs.documents')}</h2>
        <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
          {/* BugFix-07 (Q3): Paperless-Verknuepfung – eigenes Panel, damit
              beliebig viele Dokumente nacheinander verbunden werden koennen. */}
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
                <span style={{ fontSize: '1.5rem' }}>📄</span>
                <div>
                  <strong>{doc.fileName}</strong>
                  <div className="text-xs text-muted" style={{ marginTop: 'var(--versigo-space-1)' }}>
                    {isLinked(doc) && (
                      <>
                        {t('policies.paperlessLinkedDocument')}
                        {doc.category && ` · ${doc.category}`}
                      </>
                    )}
                    {!isLinked(doc) && (
                      <>
                        {doc.mimeType && `${doc.mimeType} · `}
                        {formatFileSize(doc.fileSize)}
                        {doc.category && ` · ${t('policies.documentCategory')}: ${doc.category}`}
                      </>
                    )}
                    {doc.documentDate && ` · ${t('policies.documentDate')}: ${new Date(doc.documentDate).toLocaleDateString()}`}
                    {' · '}{t('common.uploadedAt', { date: new Date(doc.uploadedAt).toLocaleDateString() })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
                {/* BugFix-07 (Q3): PAPERLESS_LINK-Dokumente haben keinen
                    lokalen Dateiinhalt – statt Vorschau/Download wird der
                    Paperless-Deep-Link angeboten. */}
                {isLinked(doc) ? (
                  doc.deepLink ? (
                    <a href={doc.deepLink} target="_blank" rel="noopener noreferrer">
                      <Button variant="secondary" size="sm">{t('policies.paperlessOpenInPaperless')}</Button>
                    </a>
                  ) : (
                    <span className="badge badge-neutral" style={{ alignSelf: 'center' }}>{t('policies.paperlessLinkedDocument')}</span>
                  )
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
                <Button variant="danger" size="sm" onClick={() => handleDelete(doc.id)}>{t('policies.deleteDocument')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
