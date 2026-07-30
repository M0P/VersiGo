'use client';

import { useState, type ReactElement, type FormEvent } from 'react';

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
    <div>
      <h1>Integrationen &amp; Connectivity-Tests</h1>

      {error && <p style={{ color: 'red' }}>Fehler: {error}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Connectivity-Test</h2>
        <form onSubmit={handleTest} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 400 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem' }}>Integrations-Key</label>
            <select
              value={integrationKey}
              onChange={(e) => setIntegrationKey(e.target.value)}
              required
              style={{ padding: '0.3rem', width: '100%' }}
            >
              <option value="">Bitte w&auml;hlen...</option>
              <option value="database">Datenbank</option>
              <option value="redis">Redis</option>
              <option value="oidc">OIDC-Provider</option>
              <option value="paperless">Paperless-ngx</option>
              <option value="ai">AI-Provider</option>
              <option value="storage">S3/Speicher</option>
              <option value="custom">Benutzerdefiniert</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem' }}>Endpoint (optional)</label>
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://example.com/api"
              style={{ padding: '0.3rem', width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem' }}>API-Token (optional)</label>
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="Nur fuer Authentifizierung"
              style={{ padding: '0.3rem', width: '100%' }}
            />
          </div>
          <button type="submit" disabled={testing} style={{ padding: '0.3rem 0.8rem' }}>
            {testing ? 'Teste...' : 'Test starten'}
          </button>
        </form>
      </section>

      {result && (
        <section>
          <h2>Testergebnis</h2>
          <p>
            Status:{' '}
            <strong style={{ color: result.success ? 'green' : 'red' }}>
              {result.success ? 'Erfolgreich' : 'Fehlgeschlagen'}
            </strong>
          </p>
          <p>Meldung: {result.message}</p>
          <p style={{ fontSize: '0.8rem', color: '#666' }}>
            Zeitstempel: {result.timestamp}
          </p>
        </section>
      )}
    </div>
  );
}
