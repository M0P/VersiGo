'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Input } from '@/components/ui/form-field';
import { Alert } from '@/components/ui/alert';
import { InlineSpinner } from '@/components/ui/loading';
import { useI18n, formatDateDmy } from '@/i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import { useAiDataTransferConsent } from '@/hooks/use-ai-data-transfer-consent';
import { documentTypeIcon, documentTypeKind, documentTypeLabelKey } from '@/lib/document-type';
import { documentOriginIcon, documentOriginKind, documentOriginLabelKey } from '@/lib/documents-view';
import {
  buildCostEntryPrefill,
  type CostEntryPrefill,
} from '@/lib/cost-suggestion';

const API_BASE = getApiBaseUrl();

/**
 * AP-25: a PAPERLESS_LINK document has no local file, so the embedded
 * preview (which streams the stored file) can never work for it. The
 * documents tab offers the Paperless deep link for those documents.
 */
function isLinkedDocument(doc: BillingDocument): boolean {
  return doc.storageType === 'PAPERLESS_LINK';
}

/** AP-24 (§4.1): a BILLING document as delivered by the costs endpoint. */
type BillingDocument = {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  documentDate: string | null;
  storageType: string;
  storageRef: string | null;
  linkOriginManual: boolean;
  linkOriginTag: boolean;
  aiProcessingExcluded: boolean;
  /** Cost entries that already reference this document. */
  usedByCostEntries: { id: string; validFrom: string; frequency: string }[];
};

/** Raw answer of the cost-suggestion endpoint. */
type CostSuggestionResponse = {
  document: { id: string; fileName: string };
  suggestion: unknown;
  existingEntries: { id: string }[];
  model: string;
  providerKey: string;
};

type Props = {
  policyId: string;
  /** Incremented by the parent after cost changes to refresh the marking. */
  refreshToken: number;
  /** Switches to the documents tab so the user can classify documents. */
  onOpenClassification: () => void;
  /** Prefills and reveals the create form of the cost card. */
  onPrefill: (prefill: CostEntryPrefill) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

/** Result code → i18n key of a failed cost extraction. */
const EXTRACTION_ERROR_KEYS: Record<string, string> = {
  DOCUMENT_EXCLUDED_FROM_AI: 'costs.aiErrorExcluded',
  DOCUMENT_PAYLOAD_TOO_LARGE: 'costs.aiErrorTooLarge',
  AI_COST_EXTRACTION_UNSUPPORTED: 'costs.aiErrorUnsupported',
  AI_COST_EXTRACTION_INVALID_FORMAT: 'costs.aiErrorInvalidFormat',
  AI_COST_EXTRACTION_FAILED: 'costs.aiErrorFailed',
};

/**
 * AP-24 (§4.1): sidebar with the documents of the policy classified as
 * `BILLING`.
 *
 * - shows title, date, origin and whether the document is already referenced
 *   by a cost entry,
 * - opens the document preview in place (the costs view stays visible),
 * - offers the AI cost extraction when the AI feature is configured
 *   (`capable`), and asks for the data-transfer confirmation first,
 * - the AI result is only a proposal: it prefills the create form of the cost
 *   card and is stored exclusively through the regular cost endpoint.
 *
 * Known limitation: `API_BASE` and the hardcoded `default` household follow
 * the house-wide pattern of the web app (no real session evaluation yet).
 */
export default function BillingDocumentsSidebar({
  policyId,
  refreshToken,
  onOpenClassification,
  onPrefill,
  collapsed,
  onToggleCollapsed,
}: Props): ReactElement {
  const { t } = useI18n();
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [aiCapable, setAiCapable] = useState(false);
  // AP-25: the central consent given in the profile (`/settings`) suppresses
  // the data-transfer notice. The checkbox of this action stays per action –
  // confirming here never silently becomes a permanent consent.
  const { acknowledged: storedTransferConsent } = useAiDataTransferConsent();
  const [transferAcknowledged, setTransferAcknowledged] = useState(false);

  useEffect(() => {
    if (storedTransferConsent) setTransferAcknowledged(true);
  }, [storedTransferConsent]);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/households/default/policies/${policyId}/costs/billing-documents`, {
      credentials: 'include',
    })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error('load failed');
        return res.json() as Promise<{ documents?: BillingDocument[] }>;
      })
      .then((data) => {
        if (cancelled || data === null) return;
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
        setLoadError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDocuments([]);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [policyId, refreshToken]);

  // AP-24 (§4.2): the AI action is only offered when the feature is enabled
  // AND configured – the server reports that as `capable`.
  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/households/default/ai/status`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { connected?: boolean; capable?: boolean } | null) => {
        if (cancelled) return;
        setAiCapable(Boolean(data?.connected) && Boolean(data?.capable));
      })
      .catch(() => {
        // Without a confirmed capability the action stays hidden – the
        // server refuses it anyway (never a security-relevant decision).
        if (!cancelled) setAiCapable(false);
      });

    return () => { cancelled = true; };
  }, [policyId]);

  function requestCostSuggestion(document: BillingDocument): void {
    setActionError(null);
    setBusyDocumentId(document.id);

    fetch(
      `${API_BASE}/households/default/ai/${policyId}/documents/${document.id}/cost-suggestion`,
      { method: 'POST', credentials: 'include' },
    )
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { code?: string; message?: string } | null;
          // The API answers with a machine-readable code; the user gets a
          // translated message. An unknown code never renders raw text.
          const key = body?.code ? EXTRACTION_ERROR_KEYS[body.code] : undefined;
          setActionError(key ? t(key) : t('costs.aiError'));
          return null;
        }
        return res.json() as Promise<CostSuggestionResponse>;
      })
      .then((data) => {
        if (!data) return;
        onPrefill(
          buildCostEntryPrefill(
            data.suggestion as never,
            document.id,
            // A fresh token per proposal: the same document may legitimately
            // be used for a second entry.
            `${document.id}-${String(Date.now())}`,
            data.existingEntries.length,
          ),
        );
      })
      .catch(() => setActionError(t('costs.aiError')))
      .finally(() => setBusyDocumentId(null));
  }

  const needle = search.trim().toLowerCase();
  const visibleDocuments = needle
    ? documents.filter((doc) => doc.fileName.toLowerCase().includes(needle))
    : documents;

  const sidebarId = 'costs-billing-documents-body';

  return (
    <>
      {/* Mobile only: the expanded sidebar is a bottom sheet with a backdrop. */}
      {!collapsed && (
        <div className="costs-sidebar-backdrop" aria-hidden="true" onClick={onToggleCollapsed} />
      )}

      <aside
        className="costs-sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        aria-label={t('costs.billingDocumentsTitle')}
      >
        <div className="costs-sidebar-header">
          <h2 style={{ margin: 0, fontSize: 'var(--versigo-font-size-lg)' }}>
            {t('costs.billingDocumentsTitle')}
          </h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="costs-sidebar-toggle"
            aria-expanded={!collapsed}
            aria-controls={sidebarId}
            onClick={onToggleCollapsed}
          >
            {collapsed ? t('costs.sidebarShow') : t('costs.sidebarHide')}
          </Button>
        </div>

        <div className="costs-sidebar-body" id={sidebarId}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--versigo-space-4)' }}>
              <InlineSpinner />
            </div>
          ) : loadError ? (
            <Alert variant="danger">{t('costs.billingDocumentsError')}</Alert>
          ) : documents.length === 0 ? (
            <div>
              <p className="text-muted">{t('costs.billingDocumentsEmpty')}</p>
              <Button type="button" size="sm" variant="secondary" onClick={onOpenClassification}>
                {t('costs.billingDocumentsEmptyAction')}
              </Button>
            </div>
          ) : (
            <>
              <Input
                type="search"
                value={search}
                placeholder={t('costs.billingDocumentsSearch')}
                aria-label={t('costs.billingDocumentsSearch')}
                onChange={(event) => setSearch(event.target.value)}
              />

              {actionError && (
                <div style={{ margin: 'var(--versigo-space-3) 0' }}>
                  <Alert variant="danger">
                    {actionError}
                    <p style={{ margin: '0.25rem 0 0' }}>{t('costs.aiErrorHint')}</p>
                  </Alert>
                </div>
              )}

              {aiCapable && (
                <div style={{ margin: 'var(--versigo-space-3) 0' }}>
                  {!storedTransferConsent && (
                    <Alert variant="info">{t('ai.dataTransferNotice')}</Alert>
                  )}
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={transferAcknowledged}
                      onChange={(event) => setTransferAcknowledged(event.target.checked)}
                    />
                    <span>{t('ai.dataTransferConfirm')}</span>
                  </label>
                  {!transferAcknowledged && (
                    <p className="form-hint">{t('ai.dataTransferRequired')}</p>
                  )}
                </div>
              )}

              {visibleDocuments.length === 0 ? (
                <p className="text-muted">{t('costs.noSearchResults')}</p>
              ) : (
                <ul className="costs-document-list">
                  {visibleDocuments.map((doc) => {
                    const originKind = documentOriginKind(doc);
                    const typeKind = documentTypeKind(doc.mimeType, doc.fileName);
                    const usedCount = doc.usedByCostEntries.length;

                    return (
                      <li key={doc.id} className="costs-document-item">
                        <div className="costs-document-title">{doc.fileName}</div>
                        <div className="costs-document-meta">
                          <span>
                            <Icon name={documentTypeIcon(typeKind)} size={14} />
                            <span className="sr-only">{t(documentTypeLabelKey(typeKind))}</span>
                          </span>
                          <span>{doc.documentDate ? formatDateDmy(doc.documentDate) : t('costs.noDate')}</span>
                          <span>
                            <Icon name={originKind ? documentOriginIcon(originKind) : 'fileGeneric'} size={14} />
                            {' '}
                            {originKind ? t(documentOriginLabelKey(originKind)) : t('costs.originLocal')}
                          </span>
                          {usedCount > 0 && (
                            <span className="badge badge-success">
                              {t('costs.documentUsed', { count: String(usedCount) })}
                            </span>
                          )}
                        </div>

                        <div className="costs-document-actions">
                          {/* AP-25: a PAPERLESS_LINK document has no local
                              file, so the embedded preview cannot work. The
                              explicit note replaces a broken frame; the
                              documents tab offers the deep link. */}
                          {isLinkedDocument(doc) ? (
                            <span className="costs-document-hint">
                              {t('costs.previewInPaperlessOnly')}
                            </span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              aria-expanded={previewId === doc.id}
                              onClick={() => setPreviewId(previewId === doc.id ? null : doc.id)}
                            >
                              {previewId === doc.id ? t('costs.hidePreview') : t('costs.showPreview')}
                            </Button>
                          )}
                          {aiCapable && (
                            <Button
                              type="button"
                              size="sm"
                              disabled={!transferAcknowledged || busyDocumentId !== null}
                              onClick={() => requestCostSuggestion(doc)}
                            >
                              {busyDocumentId === doc.id ? t('costs.aiExtracting') : t('costs.aiExtract')}
                            </Button>
                          )}
                        </div>

                        {previewId === doc.id && !isLinkedDocument(doc) && (
                          <iframe
                            className="costs-preview-frame"
                            title={`${t('costs.documentPreviewTitle')}: ${doc.fileName}`}
                            src={`${API_BASE}/households/default/policies/${policyId}/documents/${doc.id}/preview`}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
