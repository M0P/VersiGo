'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { useI18n, type Translator } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';
import {
  isCoverageSummaryDocument,
  legacyMarkdownBlocks,
  type CoverageSummaryDocument,
} from '@/lib/coverage-summary';

const API_BASE = getApiBaseUrl();

type SourceDocument = {
  id: string;
  fileName: string;
};

/** AP-24 (§3.1): a CONTRACT document that can be used for a summary. */
type DocumentOption = {
  id: string;
  fileName: string;
  aiProcessingExcluded?: boolean;
};

/** AP-24 (§3.1): a document the flow could not use, as reported by the API. */
type SkippedDocumentInfo = {
  id: string;
  fileName: string;
  reason: string;
};

type CoverageSummary = {
  id: string;
  policyId: string;
  providerKey: string;
  model: string | null;
  /** AP-24 (§3.2): `json` for structured summaries, `markdown` for old rows. */
  format?: string;
  /** Present for `format: 'json'`; re-validated before rendering. */
  summary?: unknown;
  summaryMarkdown: string;
  sourceDocuments: SourceDocument[];
  createdAt: string;
};

type AiHealth = {
  connected: boolean;
  provider: string;
  /** Coarse, secret-free reason why the provider is unavailable (BugFix-22). */
  reason?: string | null;
};

/**
 * Maps the machine-readable reason codes of `GET .../ai/status` to the
 * corresponding i18n key (BugFix-22). Unknown codes fall back to a generic
 * hint instead of rendering the raw code.
 */
const AI_REASON_KEYS: Record<string, string> = {
  disabled: 'ai.reasonDisabled',
  'not-configured': 'ai.reasonNotConfigured',
  unauthorized: 'ai.reasonUnauthorized',
  timeout: 'ai.reasonTimeout',
  unreachable: 'ai.reasonUnreachable',
  'http-error': 'ai.reasonHttpError',
};

/**
 * Human hint for a reason code; empty string when unknown, so an unexpected
 * code never renders as a raw token (BugFix-22).
 */
function aiReasonHint(t: Translator, reason: string | null | undefined): string {
  const key = reason ? AI_REASON_KEYS[reason] : undefined;
  return key ? t(key) : '';
}

/** AP-24 (§3.1): i18n key of the reason why a document cannot be used. */
const SKIP_REASON_KEYS: Record<string, string> = {
  EXCLUDED_FROM_AI: 'ai.skipExcludedFromAi',
  EMPTY_FILE_NAME: 'ai.skipEmptyFileName',
  UNSUPPORTED_TYPE: 'ai.skipUnsupportedType',
};

function skipReasonLabel(t: Translator, reason: string): string {
  const key = SKIP_REASON_KEYS[reason];
  return key ? t(key) : t('ai.skipUnknownReason');
}

type DocumentPickerProps = {
  documents: DocumentOption[];
  selectedIds: string[];
  acknowledged: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onAcknowledge: (value: boolean) => void;
};

/**
 * AP-24 (§3.1): optional selection of the CONTRACT documents plus the data
 * transfer consent. The selection is optional – an empty selection keeps the
 * historic behaviour (all documents of the policy).
 */
function DocumentPicker({
  documents,
  selectedIds,
  acknowledged,
  onToggle,
  onSelectAll,
  onSelectNone,
  onAcknowledge,
}: DocumentPickerProps): ReactElement {
  const { t } = useI18n();

  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
      <legend className="form-label">{t('ai.selectDocuments')}</legend>

      {documents.length === 0 ? (
        <p className="form-hint">{t('ai.noContractDocuments')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexWrap: 'wrap' }}>
            <Button type="button" variant="secondary" size="sm" onClick={onSelectAll}>
              {t('ai.selectAllDocuments')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onSelectNone}>
              {t('ai.selectNoDocuments')}
            </Button>
          </div>
          <ul style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0 }}>
            {documents.map((doc) => (
              <li key={doc.id} style={{ padding: '0.15rem 0' }}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => onToggle(doc.id)}
                  />
                  <span>{doc.fileName}</span>
                  {doc.aiProcessingExcluded && (
                    <span className="text-xs text-muted">{t('ai.documentExcluded')}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <p className="form-hint">
            {selectedIds.length === 0
              ? t('ai.noSelectionHint')
              : t('ai.selectedCount', { count: String(selectedIds.length) })}
          </p>
        </>
      )}

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.5rem' }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledge(event.target.checked)}
        />
        <span>{t('ai.dataTransferConfirm')}</span>
      </label>
      {!acknowledged && <p className="form-hint">{t('ai.dataTransferRequired')}</p>}
    </fieldset>
  );
}

type Props = {
  householdId: string;
  policyId: string;
};

type ViewState =
  | { status: 'loading' }
  | { status: 'ai-unavailable'; provider: string; reason: string | null }
  | { status: 'ai-check-error'; message: string }
  | { status: 'idle'; aiAvailable: boolean }
  | { status: 'summary-load-error'; message: string }
  | { status: 'loaded'; summary: CoverageSummary }
  | { status: 'generating' }
  | { status: 'generate-error'; message: string };

/**
 * AI benefit summary with source references, status and disclaimer.
 *
 * AP-24 (§3.1/§3.2):
 * - the summary can optionally be based on selected CONTRACT documents of the
 *   policy; without a selection the previous behaviour is unchanged,
 * - document content is only sent after the user confirmed the data transfer,
 * - documents that cannot be used are named and the summary runs with the
 *   usable ones only after an explicit confirmation,
 * - the answer is validated server-side against a versioned schema and
 *   rendered from that structure; summaries created before AP-24 are still
 *   displayed through a compatible plain-text rendering.
 *
 * Known limitations:
 * - API_BASE is duplicated in every component (house-wide pattern).
 * - householdId is hardcoded to "default" because the web app has no real
 *   session evaluation for the household context yet.
 *
 * The summary is machine-generated, marked as such, and does not replace the
 * original contract documents.
 */
export default function CoverageSummarySection({ householdId, policyId }: Props): ReactElement {
  const { t, language } = useI18n();
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' });
  // AP-24 (§3.1): optional document selection + data transfer consent.
  const [contractDocuments, setContractDocuments] = useState<DocumentOption[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [transferAcknowledged, setTransferAcknowledged] = useState(false);
  // Documents the API could not use; the user decides whether to continue.
  const [skippedDocuments, setSkippedDocuments] = useState<SkippedDocumentInfo[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1. Check the AI status
      let health: AiHealth;
      try {
        const res = await fetch(
          `${API_BASE}/households/${householdId}/ai/status`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          health = { connected: false, provider: 'unknown' };
        } else {
          health = await res.json() as AiHealth;
        }
      } catch {
        if (!cancelled) setViewState({
          status: 'ai-check-error',
          message: t('ai.checkError'),
        });
        return;
      }

      if (!health.connected) {
        if (!cancelled) {
          setViewState({
            status: 'ai-unavailable',
            provider: health.provider,
            reason: health.reason ?? null,
          });
        }
        return;
      }

      // 2. Load an existing summary
      try {
        const res = await fetch(
          `${API_BASE}/households/${householdId}/ai/${policyId}/summary`,
          { credentials: 'include' },
        );

        if (res.status === 404) {
          if (!cancelled) setViewState({ status: 'idle', aiAvailable: true });
          return;
        }

        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          if (!cancelled) setViewState({
            status: 'summary-load-error',
            message: t('ai.loadError'),
          });
          return;
        }

        const summary = await res.json() as CoverageSummary;
        if (!cancelled) setViewState({ status: 'loaded', summary });
      } catch {
        if (!cancelled) setViewState({
          status: 'summary-load-error',
          message: t('ai.loadErrorNetwork'),
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [householdId, policyId, t]);

  // AP-24 (§3.1): only CONTRACT documents are offered. Loaded once the AI
  // status is known, so an instance without AI never requests them.
  const aiAvailable =
    viewState.status === 'idle' ||
    viewState.status === 'loaded' ||
    viewState.status === 'generate-error';

  useEffect(() => {
    if (!aiAvailable) return;
    let cancelled = false;

    fetch(
      `${API_BASE}/households/${householdId}/policies/${policyId}/documents?documentClass=CONTRACT`,
      { credentials: 'include' },
    )
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DocumentOption[] | null) => {
        if (!cancelled) setContractDocuments(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        // A missing document list must never block the existing flow: the
        // summary then simply runs without a selection.
        if (!cancelled) setContractDocuments([]);
      });

    return () => { cancelled = true; };
  }, [aiAvailable, householdId, policyId]);

  async function runSummarize(documentIds: string[], acceptPartial: boolean): Promise<void> {
    setViewState({ status: 'generating' });
    setSkippedDocuments([]);
    setActionError(null);

    try {
      const res = await fetch(
        `${API_BASE}/households/${householdId}/ai/${policyId}/summarize`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          // Without a selection the body keeps the historic behaviour.
          body: JSON.stringify({
            ...(documentIds.length > 0 ? { documentIds } : {}),
            ...(acceptPartial ? { acceptPartial: true } : {}),
          }),
        },
      );

      if (res.status === 401) { window.location.href = '/login'; return; }

      if (!res.ok) {
        // AP-24 (§3.1): name the concrete problem instead of a generic error -
        // especially the documents that cannot be used.
        const body = await res.json().catch(() => null) as
          | { code?: string; maxDocuments?: number; skippedDocuments?: SkippedDocumentInfo[] }
          | null;
        const code = body?.code;

        if (code === 'UNUSABLE_DOCUMENTS' || code === 'NO_USABLE_DOCUMENTS') {
          setSkippedDocuments(body?.skippedDocuments ?? []);
          setActionError(
            code === 'NO_USABLE_DOCUMENTS'
              ? t('ai.errorNoUsableDocuments')
              : t('ai.errorUnusableDocuments'),
          );
          setViewState({ status: 'idle', aiAvailable: true });
          return;
        }

        setActionError(
          code === 'TOO_MANY_DOCUMENTS'
            ? t('ai.errorTooManyDocuments', { max: String(body?.maxDocuments ?? '') })
            : code === 'INVALID_DOCUMENT_SELECTION'
              ? t('ai.errorInvalidSelection')
              : code === 'DOCUMENT_PAYLOAD_TOO_LARGE'
                ? t('ai.errorPayloadTooLarge')
                : t('ai.generateError'),
        );
        setViewState({ status: 'idle', aiAvailable: true });
        return;
      }

      const postData = await res.json() as {
        format?: string;
        summary?: unknown;
        summaryMarkdown: string;
        model: string;
        sourceDocuments?: SourceDocument[];
        skippedDocuments?: SkippedDocumentInfo[];
      };

      // Documents the flow left out are named - never silently dropped.
      setSkippedDocuments(postData.skippedDocuments ?? []);

      setViewState({
        status: 'loaded',
        summary: {
          id: '',
          policyId,
          providerKey: '',
          model: postData.model,
          format: postData.format === 'json' ? 'json' : 'markdown',
          summary: postData.summary ?? null,
          summaryMarkdown: postData.summaryMarkdown,
          sourceDocuments: postData.sourceDocuments ?? [],
          createdAt: new Date().toISOString(),
        },
      });

      void loadPersistedSummary();
    } catch {
      setViewState({
        status: 'generate-error',
        message: t('ai.generateErrorNetwork'),
      });
    }
  }

  async function loadPersistedSummary(): Promise<void> {
    try {
      const res = await fetch(
        `${API_BASE}/households/${householdId}/ai/${policyId}/summary`,
        { credentials: 'include' },
      );

      if (res.status === 404) {
        setViewState({ status: 'idle', aiAvailable: true });
        return;
      }

      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        setViewState({
          status: 'summary-load-error',
          message: t('ai.loadError'),
        });
        return;
      }

      const summary = await res.json() as CoverageSummary;
      setViewState({ status: 'loaded', summary });
    } catch {
      setViewState({
        status: 'summary-load-error',
        message: t('ai.loadErrorNetwork'),
      });
    }
  }

  function handleGenerate(acceptPartial = false): void {
    void runSummarize(selectedDocumentIds, acceptPartial);
  }

  function toggleDocument(id: string): void {
    setSelectedDocumentIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function renderDisclaimer(providerKey?: string): ReactElement {
    const provider = providerKey || t('ai.unknown');
    return (
      <p
        style={{
          fontSize: '0.8em',
          fontStyle: 'italic',
          color: 'var(--versigo-text-muted)',
          borderLeft: '3px solid var(--versigo-border)',
          paddingLeft: '0.5rem',
          marginTop: '0.5rem',
        }}
      >
        <strong>{t('ai.disclaimerTitle')}</strong> – {t('ai.disclaimerBody', { provider })}
      </p>
    );
  }

  function renderSourceDocuments(docs: SourceDocument[]): ReactElement | null {
    if (docs.length === 0) return null;
    return (
      <div style={{ marginTop: '0.75rem' }}>
        <h4 style={{ margin: '0 0 0.25rem' }}>{t('ai.sources')}</h4>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {docs.map((doc) => (
            <li key={doc.id}>{doc.fileName}</li>
          ))}
        </ul>
      </div>
    );
  }

  /**
   * AP-24 (§3.1): documents that could not be used. Reportedly named, so the
   * user can decide whether the rest is enough.
   */
  function renderSkippedDocuments(): ReactElement | null {
    if (skippedDocuments.length === 0) return null;
    return (
      <div style={{ marginBottom: 'var(--versigo-space-4)' }}>
        <Alert variant="warning">
          <strong>{t('ai.skippedTitle')}</strong>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
            {skippedDocuments.map((doc) => (
              <li key={doc.id}>
                {doc.fileName} – {skipReasonLabel(t, doc.reason)}
              </li>
            ))}
          </ul>
          <p style={{ margin: '0.5rem 0 0' }}>{t('ai.skippedHint')}</p>
        </Alert>
      </div>
    );
  }

  function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  function renderMetadata(summary: CoverageSummary): ReactElement {
    return (
      <div style={{ marginTop: '0.5rem', fontSize: '0.85em', color: 'var(--versigo-text-muted)' }}>
        {t('ai.createdAt', { date: formatDateTime(summary.createdAt) })}
        {' | '}{t('ai.model', { model: summary.model ?? t('ai.unknown') })}
        {' | '}{t('ai.provider', { provider: summary.providerKey || t('ai.unknown') })}
      </div>
    );
  }

  /**
   * AP-24 (§3.2): renders the validated structure. Every value is rendered as
   * text through React, so markup or scripts inside a model answer can never
   * be executed and no `dangerouslySetInnerHTML` is involved.
   */
  function renderStructuredSummary(document: unknown): ReactElement | null {
    if (!isCoverageSummaryDocument(document)) return null;
    const parsed: CoverageSummaryDocument = document;

    return (
      <div>
        {parsed.sections.map((section, index) => (
          <section key={`section-${index}`} style={{ marginTop: index === 0 ? 0 : '1rem' }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05em' }}>{section.title}</h3>
            {section.items.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {section.items.map((item, itemIndex) => (
                  <li key={`item-${itemIndex}`} style={{ margin: '0.15rem 0' }}>{item}</li>
                ))}
              </ul>
            )}
            {section.note && (
              <p className="text-muted" style={{ margin: '0.25rem 0 0' }}>{section.note}</p>
            )}
          </section>
        ))}

        {parsed.hints.length > 0 && (
          <section style={{ marginTop: '1rem' }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05em' }}>{t('ai.hints')}</h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {parsed.hints.map((hint, index) => (
                <li key={`hint-${index}`}>{hint}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  /**
   * Compatible rendering of summaries created before AP-24 (restricted
   * Markdown subset). Markup stays literal text - it is never interpreted.
   *
   * Consecutive list items are grouped into a real `<ul>`: an `<li>` outside
   * a list is invalid HTML and would be flattened by assistive technology.
   */
  function renderLegacyMarkdown(markdown: string): ReactElement {
    const elements: ReactElement[] = [];
    let listItems: string[] = [];

    const flushList = (key: string) => {
      if (listItems.length === 0) return;
      const items = listItems;
      listItems = [];
      elements.push(
        <ul key={`${key}-list`} style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>
          {items.map((text, itemIndex) => (
            <li key={itemIndex}>{text}</li>
          ))}
        </ul>,
      );
    };

    legacyMarkdownBlocks(markdown).forEach((block, index) => {
      if (block.kind === 'listItem') {
        listItems.push(block.text);
        return;
      }
      flushList(String(index));
      if (block.kind === 'heading1') {
        elements.push(<h3 key={index} style={{ margin: '1rem 0 0.5rem' }}>{block.text}</h3>);
      } else if (block.kind === 'heading2') {
        elements.push(<h4 key={index} style={{ margin: '0.75rem 0 0.25rem' }}>{block.text}</h4>);
      } else if (block.kind === 'blank') {
        elements.push(<br key={index} />);
      } else {
        elements.push(<p key={index} style={{ margin: '0.25rem 0' }}>{block.text}</p>);
      }
    });
    flushList('end');

    return <div style={{ lineHeight: 1.6 }}>{elements}</div>;
  }

  function renderPicker(): ReactElement {
    return (
      <DocumentPicker
        documents={contractDocuments}
        selectedIds={selectedDocumentIds}
        acknowledged={transferAcknowledged}
        onToggle={toggleDocument}
        onSelectAll={() => setSelectedDocumentIds(contractDocuments.map((doc) => doc.id))}
        onSelectNone={() => setSelectedDocumentIds([])}
        onAcknowledge={setTransferAcknowledged}
      />
    );
  }

  function renderActions(acceptPartial: boolean): ReactElement {
    return (
      <div style={{ display: 'flex', gap: 'var(--versigo-space-2)', flexWrap: 'wrap', marginTop: 'var(--versigo-space-3)' }}>
        <Button onClick={() => handleGenerate(acceptPartial)} disabled={!transferAcknowledged}>
          {selectedDocumentIds.length === 0 ? t('ai.generate') : t('ai.generateSelected')}
        </Button>
        {skippedDocuments.length > 0 && (
          <Button variant="secondary" onClick={() => handleGenerate(true)} disabled={!transferAcknowledged}>
            {t('ai.generateUsableOnly')}
          </Button>
        )}
      </div>
    );
  }

  switch (viewState.status) {
    case 'loading':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <Loading label={t('ai.loading')} />
        </Card>
      );

    case 'ai-unavailable':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p style={{ color: 'var(--versigo-text-muted)', fontStyle: 'italic' }}>
            {t('ai.unavailable')}
            {viewState.provider === 'none'
              ? t('ai.unavailableConfig')
              : t('ai.unavailableProvider')}
            {/* BugFix-22: concrete, secret-free reason instead of a bare
                "provider does not answer". */}
            {aiReasonHint(t, viewState.reason)}
          </p>
        </Card>
      );

    case 'ai-check-error':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p style={{ color: 'var(--versigo-danger)' }}>{viewState.message}</p>
        </Card>
      );

    case 'idle':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p className="text-muted">{t('ai.noSummary')}</p>
          <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
            <Alert variant="info">{t('ai.dataTransferNotice')}</Alert>
          </div>
          {actionError && (
            <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
              <Alert variant="danger">{actionError}</Alert>
            </div>
          )}
          {renderSkippedDocuments()}
          {renderPicker()}
          {renderActions(false)}
        </Card>
      );

    case 'summary-load-error':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p style={{ color: 'var(--versigo-danger)' }}>{viewState.message}</p>
          <Button variant="secondary" onClick={() => { setViewState({ status: 'loading' }); void loadPersistedSummary(); }}>
            {t('ai.retry')}
          </Button>
        </Card>
      );

    case 'loaded': {
      const { summary } = viewState;
      return (
        <Card>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{t('ai.title')}</h2>
            {/* AP-24 (§3.1): the summary is marked as AI generated. */}
            <span className="badge badge-neutral">{t('ai.generatedBadge')}</span>
          </div>

          {actionError && (
            <div style={{ margin: 'var(--versigo-space-3) 0' }}>
              <Alert variant="danger">{actionError}</Alert>
            </div>
          )}
          {renderSkippedDocuments()}

          {renderStructuredSummary(summary.summary) ?? renderLegacyMarkdown(summary.summaryMarkdown)}

          {renderSourceDocuments(summary.sourceDocuments)}
          {renderMetadata(summary)}
          {renderDisclaimer(summary.providerKey)}

          <div style={{ marginTop: 'var(--versigo-space-4)' }}>
            <Button variant="secondary" onClick={() => handleGenerate()}>
              {t('ai.regenerate')}
            </Button>
          </div>

          <details style={{ marginTop: 'var(--versigo-space-4)' }}>
            <summary>{t('ai.regenerateWithSelection')}</summary>
            <div style={{ marginTop: 'var(--versigo-space-3)' }}>
              <Alert variant="info">{t('ai.dataTransferNotice')}</Alert>
              {renderPicker()}
              {renderActions(false)}
            </div>
          </details>
        </Card>
      );
    }

    case 'generating':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <Loading label={t('ai.generating')} />
        </Card>
      );

    case 'generate-error':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p style={{ color: 'var(--versigo-danger)' }}>{viewState.message}</p>
          <div style={{ marginBottom: 'var(--versigo-space-3)' }}>
            <Alert variant="info">{t('ai.dataTransferNotice')}</Alert>
          </div>
          {renderPicker()}
          {renderActions(false)}
        </Card>
      );

    default:
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p>{t('ai.unknownState')}</p>
        </Card>
      );
  }
}
