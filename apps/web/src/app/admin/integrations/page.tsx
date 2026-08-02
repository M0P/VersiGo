'use client';

import { useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, Select } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type ConnectivityResult = {
  success: boolean;
  message: string;
  timestamp: string;
};

export default function AdminIntegrationsPage(): ReactElement {
  const [integrationKey, setIntegrationKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [result, setResult] = useState<ConnectivityResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async (e: FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/admin/connectivity-test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrationKey,
          endpoint: endpoint || undefined,
          apiToken: apiToken || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Fehler beim Test');
      }

      const data: ConnectivityResult = await res.json();
      setResult(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Integrationen" description="Connectivity-Tests für externe Dienste" />

      {error && <Alert variant="danger">Fehler: {error}</Alert>}

      <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
        <SectionHeader title="Connectivity-Test" />
        <form onSubmit={handleTest} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--versigo-space-3)', maxWidth: 480 }}>
          <div className="form-group">
            <label className="form-label">Integrations-Key</label>
            <Select
              value={integrationKey}
              onChange={(e) => setIntegrationKey(e.target.value)}
              required
            >
              <option value="">Bitte wählen...</option>
              <option value="database">Datenbank</option>
              <option value="redis">Redis</option>
              <option value="oidc">OIDC-Provider</option>
              <option value="paperless">Paperless-ngx</option>
              <option value="ai">AI-Provider</option>
              <option value="storage">S3/Speicher</option>
              <option value="custom">Benutzerdefiniert</option>
            </Select>
          </div>
          <div className="form-group">
            <label className="form-label">Endpoint (optional)</label>
            <Input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://example.com/api"
            />
          </div>
          <div className="form-group">
            <label className="form-label">API-Token (optional)</label>
            <Input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="Nur für Authentifizierung"
            />
          </div>
          <Button type="submit" disabled={testing}>
            {testing ? <><InlineSpinner /> Teste...</> : 'Test starten'}
          </Button>
        </form>
        <p className="form-hint">
          Aus SSRF-Schutz sind nur oeffentliche http(s)-Endpunkte testbar;
          lokale Dienste (z. B. Ollama unter localhost) pruefen Sie bitte
          direkt auf dem Host.
        </p>
      </Card>

      {result && (
        <Card>
          <SectionHeader title="Testergebnis" />
          <p>
            Status:{' '}
            <strong style={{ color: result.success ? 'var(--versigo-success)' : 'var(--versigo-danger)' }}>
              {result.success ? 'Erfolgreich' : 'Fehlgeschlagen'}
            </strong>
          </p>
          <p>Meldung: {result.message}</p>
          <p className="text-xs text-muted">Zeitstempel: {result.timestamp}</p>
        </Card>
      )}
    </AppShell>
  );
}
