'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

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
 *   Bibliothek nach Maintenance-Prüfung ergaenzt werden.
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
          message: 'AI-Status konnte nicht geprueft werden.',
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
            message: 'Zusammenfassung konnte nicht geladen werden.',
          });
          return;
        }

        const summary = await res.json() as CoverageSummary;
        if (!cancelled) setViewState({ status: 'loaded', summary });
      } catch {
        if (!cancelled) setViewState({
          status: 'summary-load-error',
          message: 'Netzwerkfehler beim Laden der Zusammenfassung.',
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [householdId, policyId]);

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
          message: 'Fehler beim Erstellen der Zusammenfassung.',
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
        message: 'Netzwerkfehler beim Erstellen der Zusammenfassung.',
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
          message: 'Zusammenfassung konnte nicht geladen werden.',
        });
        return;
      }

      const summary = await res.json() as CoverageSummary;
      setViewState({ status: 'loaded', summary });
    } catch {
      setViewState({
        status: 'summary-load-error',
        message: 'Netzwerkfehler beim Laden der Zusammenfassung.',
      });
    }
  }

  function renderDisclaimer(): ReactElement {
    return (
      <p
        style={{
          fontSize: '0.8em',
          fontStyle: 'italic',
          color: 'var(--insura-text-muted)',
          borderLeft: '3px solid var(--insura-border)',
          paddingLeft: '0.5rem',
          marginTop: '0.5rem',
        }}
      >
        <strong>Vertragszusammenfassung</strong> – Diese Zusammenfassung wurde
        maschinell durch einen KI-Assistenten ({viewState.status === 'loaded' ? viewState.summary.providerKey : '?'})
        erstellt und dient ausschliesslich der schnellen Uebersicht.
        Sie stellt keine Rechtsberatung dar und ersetzt nicht die Pruefung der
        originaeren Vertragsunterlagen. Bei Unstimmigkeiten ist der
        originale Versicherungsschein massgeblich.
      </p>
    );
  }

  function renderSourceDocuments(docs: SourceDocument[]): ReactElement | null {
    if (docs.length === 0) return null;
    return (
      <div style={{ marginTop: '0.75rem' }}>
        <h4 style={{ margin: '0 0 0.25rem' }}>Verwendete Quellen</h4>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {docs.map((doc) => (
            <li key={doc.id}>{doc.fileName}</li>
          ))}
        </ul>
      </div>
    );
  }

  function renderMetadata(summary: CoverageSummary): ReactElement {
    return (
      <div style={{ marginTop: '0.5rem', fontSize: '0.85em', color: 'var(--insura-text-muted)' }}>
        Erstellt am {new Date(summary.createdAt).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
        {' | '}Modell: {summary.model ?? 'unbekannt'}
        {' | '}Provider: {summary.providerKey}
      </div>
    );
  }

  switch (viewState.status) {
    case 'loading':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <Loading label="Lade Zusammenfassung..." />
        </Card>
      );

    case 'ai-unavailable':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <p style={{ color: 'var(--insura-text-muted)', fontStyle: 'italic' }}>
            KI-Funktionen sind nicht verfügbar.
            {viewState.provider === 'none'
              ? ' Bitte AI-Konfiguration in den Admin-Einstellungen aktivieren.'
              : ' Der konfigurierte Provider antwortet nicht.'}
          </p>
        </Card>
      );

    case 'ai-check-error':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <p style={{ color: 'var(--insura-danger)' }}>{viewState.message}</p>
        </Card>
      );

    case 'no-summary':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <p className="text-muted">Noch keine Zusammenfassung vorhanden.</p>
          <Button onClick={handleGenerate}>
            Zusammenfassung erstellen
          </Button>
        </Card>
      );

    case 'summary-load-error':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <p style={{ color: 'var(--insura-danger)' }}>{viewState.message}</p>
          <Button variant="secondary" onClick={() => { setViewState({ status: 'loading' }); loadPersistedSummary(); }}>
            Erneut versuchen
          </Button>
        </Card>
      );

    case 'loaded': {
      const { summary } = viewState;
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
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

          <div style={{ marginTop: 'var(--insura-space-4)' }}>
            <Button variant="secondary" onClick={handleGenerate}>
              Neu erstellen
            </Button>
          </div>
        </Card>
      );
    }

    case 'generating':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <Loading label="Zusammenfassung wird erstellt..." />
        </Card>
      );

    case 'generate-error':
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <p style={{ color: 'var(--insura-danger)' }}>{viewState.message}</p>
          <Button variant="secondary" onClick={handleGenerate}>
            Erneut versuchen
          </Button>
        </Card>
      );

    default:
      return (
        <Card>
          <h2>KI-Leistungszusammenfassung</h2>
          <p>Unbekannter Zustand.</p>
        </Card>
      );
  }
}
