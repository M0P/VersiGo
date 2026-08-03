'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type SourceDocument = {
  id: string;
  fileName: string;
};

type CoverageSummary = {
  id: string;
  policyId: string;
  providerKey: string;
  model: string | null;
  summaryMarkdown: string;
  sourceDocuments: SourceDocument[];
  createdAt: string;
};

type AiHealth = {
  connected: boolean;
  provider: string;
};

type Props = {
  householdId: string;
  policyId: string;
};

type ViewState =
  | { status: 'loading' }
  | { status: 'ai-unavailable'; provider: string }
  | { status: 'ai-check-error'; message: string }
  | { status: 'no-summary'; aiAvailable: boolean }
  | { status: 'summary-load-error'; message: string }
  | { status: 'loaded'; summary: CoverageSummary }
  | { status: 'generating' }
  | { status: 'generate-error'; message: string };

/**
 * AI-Leistungszusammenfassung mit Quellenbezug, Status und Disclaimer.
 *
 * Bekannte Grenzen:
 * - Markdown-Rendering unterstuetzt nur #, ##, - und Absaetze.
 *   Andere Markdown-Elemente (**, `, num. Listen, Links) werden als
 *   Klartext dargestellt. Bei Bedarf kann eine sandboxed Markdown-
 *   Bibliothek nach Maintenance-Pruefung ergaenzt werden.
 * - API_BASE wird derzeit in jeder Komponente dupliziert (hausweit).
 * - householdId ist aktuell hart auf "default" gesetzt, da die
 *   Web-App noch keine echte Session-Auswertung fuer den
 *   Household-Kontext implementiert hat (hausweites Muster).
 *
 * Hinweis: Diese Zusammenfassung wird maschinell erstellt und dient
 * lediglich der schnellen Uebersicht. Sie stellt keine Rechtsberatung dar
 * und ersetzt nicht die Pruefung der originaeren Vertragsunterlagen.
 */
export default function CoverageSummarySection({ householdId, policyId }: Props): ReactElement {
  const { t, language } = useI18n();
  const [viewState, setViewState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1. AI-Status pruefen
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
        if (!cancelled) setViewState({ status: 'ai-unavailable', provider: health.provider });
        return;
      }

      // 2. Bestehende Zusammenfassung laden
      try {
        const res = await fetch(
          `${API_BASE}/households/${householdId}/ai/${policyId}/summary`,
          { credentials: 'include' },
        );

        if (res.status === 404) {
          if (!cancelled) setViewState({ status: 'no-summary', aiAvailable: true });
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

  async function handleGenerate() {
    setViewState({ status: 'generating' });

    try {
      const res = await fetch(
        `${API_BASE}/households/${householdId}/ai/${policyId}/summarize`,
        { method: 'POST', credentials: 'include' },
      );

      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) {
        setViewState({
          status: 'generate-error',
          message: t('ai.generateError'),
        });
        return;
      }

      const postData = await res.json() as { summaryMarkdown: string; model: string };
      setViewState({
        status: 'loaded',
        summary: {
          id: '',
          policyId,
          providerKey: '',
          model: postData.model,
          summaryMarkdown: postData.summaryMarkdown,
          sourceDocuments: [],
          createdAt: new Date().toISOString(),
        },
      });

      loadPersistedSummary();
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
        setViewState({ status: 'no-summary', aiAvailable: true });
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

  function renderDisclaimer(): ReactElement {
    const provider =
      viewState.status === 'loaded' ? (viewState.summary.providerKey || t('ai.unknown')) : t('ai.unknown');
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

    case 'no-summary':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p className="text-muted">{t('ai.noSummary')}</p>
          <Button onClick={handleGenerate}>
            {t('ai.generate')}
          </Button>
        </Card>
      );

    case 'summary-load-error':
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <p style={{ color: 'var(--versigo-danger)' }}>{viewState.message}</p>
          <Button variant="secondary" onClick={() => { setViewState({ status: 'loading' }); loadPersistedSummary(); }}>
            {t('ai.retry')}
          </Button>
        </Card>
      );

    case 'loaded': {
      const { summary } = viewState;
      return (
        <Card>
          <h2>{t('ai.title')}</h2>
          <div
            style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {summary.summaryMarkdown.split('\n').map((line, i) => {
              if (line.startsWith('# ')) {
                return <h3 key={i} style={{ margin: '1rem 0 0.5rem' }}>{line.slice(2)}</h3>;
              }
              if (line.startsWith('## ')) {
                return <h4 key={i} style={{ margin: '0.75rem 0 0.25rem' }}>{line.slice(3)}</h4>;
              }
              if (line.startsWith('- ')) {
                return <li key={i} style={{ marginLeft: '1rem' }}>{line.slice(2)}</li>;
              }
              if (line.trim() === '') {
                return <br key={i} />;
              }
              return <p key={i} style={{ margin: '0.25rem 0' }}>{line}</p>;
            })}
          </div>

          {renderSourceDocuments(summary.sourceDocuments)}
          {renderMetadata(summary)}
          {renderDisclaimer()}

          <div style={{ marginTop: 'var(--versigo-space-4)' }}>
            <Button variant="secondary" onClick={handleGenerate}>
              {t('ai.regenerate')}
            </Button>
          </div>
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
          <Button variant="secondary" onClick={handleGenerate}>
            {t('ai.retry')}
          </Button>
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
