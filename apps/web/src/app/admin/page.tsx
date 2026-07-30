'use client';

import { useEffect, useState, type ReactElement } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type ConfigCheck = {
  key: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
};

type ConfigValidation = {
  valid: boolean;
  timestamp: string;
  checks: ConfigCheck[];
};

export default function AdminDashboardPage(): ReactElement {
  const [validation, setValidation] = useState<ConfigValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/admin/config-validation`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return Promise.resolve(null);
        }
        if (!res.ok) throw new Error('Fehler beim Laden');
        return res.json();
      })
      .then((data) => {
        if (data) setValidation(data);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main><p>Lade Admin-&Uuml;bersicht...</p></main>;
  if (error) return <main><p>Fehler: {error}</p></main>;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ok': return '\u2705';
      case 'warn': return '\u26A0\uFE0F';
      case 'error': return '\u274C';
      default: return '\u2753';
    }
  };

  return (
    <div>
      <h1>Admin-&Uuml;bersicht</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Konfigurationsvalidierung</h2>
        <p>
          Gesamtstatus:{' '}
          <strong style={{ color: validation?.valid ? 'green' : 'red' }}>
            {validation?.valid ? 'G\u00FCltig' : 'Fehlerhaft'}
          </strong>
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Status</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Schl&uuml;ssel</th>
              <th style={{ padding: '0.5rem', borderBottom: '1px solid #ccc' }}>Meldung</th>
            </tr>
          </thead>
          <tbody>
            {validation?.checks.map((check) => (
              <tr key={check.key}>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  {statusIcon(check.status)}
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  <code>{check.key}</code>
                </td>
                <td style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  {check.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
