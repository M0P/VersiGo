'use client';

import { useState, type ReactElement, type FormEvent } from 'react';
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

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch {
      setError(t('policies.noDocumentsBody'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFormError(t('policies.documentFile') + ' ' + t('common.required'));
      return;
    }
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
      setFile(null);
      setForm({ category: '', documentDate: '' });
      setShowForm(false);
      loadDocuments();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('policies.confirmDeleteDocument'))) return;
    try {
      const res = await fetch(`${API_BASE}/households/default/policies/${policyId}/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.unknownError'));
      loadDocuments();
    } catch {
      setError(t('common.unknownError'));
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--versigo-space-4)' }}>
        <h2>{t('policies.tabs.documents')}</h2>
        <Button variant="primary" onClick={() => setShowForm(true)}>
          {t('policies.uploadDocument')}
        </Button>
      </div>

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
                    {doc.mimeType && `${doc.mimeType} · `}
                    {formatFileSize(doc.fileSize)}
                    {doc.category && ` · ${t('policies.documentCategory')}: ${doc.category}`}
                    {doc.documentDate && ` · ${t('policies.documentDate')}: ${new Date(doc.documentDate).toLocaleDateString()}`}
                    {' · '}{t('common.uploadedAt', { date: new Date(doc.uploadedAt).toLocaleDateString() })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--versigo-space-2)' }}>
                <a href={`${API_BASE}/households/default/policies/${policyId}/documents/${doc.id}/preview`} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" size="sm">{t('policies.previewDocument')}</Button>
                </a>
                <a href={`${API_BASE}/households/default/policies/${policyId}/documents/${doc.id}/download`}>
                  <Button variant="secondary" size="sm">{t('policies.downloadDocument')}</Button>
                </a>
                <Button variant="danger" size="sm" onClick={() => handleDelete(doc.id)}>{t('policies.deleteDocument')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}