'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../components/ui/page-header';
import { Card } from '../../components/ui/card';
import { Loading } from '../../components/ui/loading';
import { Alert } from '../../components/ui/alert';
import { NAV_SECTIONS } from '../../components/ui/nav-config';

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
        if (res.status === 403) {
          window.location.href = '/forbidden';
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

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Admin-Übersicht" />
        <Loading label="Lade Admin-Übersicht..." />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Admin-Übersicht" />
        <Alert variant="danger">Fehler: {error}</Alert>
      </AppShell>
    );
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'ok': return '✅';
      case 'warn': return '⚠️';
      case 'error': return '❌';
      default: return '❓';
    }
  };

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Admin-Übersicht" />

      <Card>
        <SectionHeader title="Konfigurationsvalidierung" />
        <p>
          Gesamtstatus:{' '}
          <strong style={{ color: validation?.valid ? 'var(--versigo-success)' : 'var(--versigo-danger)' }}>
            {validation?.valid ? 'Gültig' : 'Fehlerhaft'}
          </strong>
        </p>
        <div className="table-container" style={{ marginTop: 'var(--versigo-space-4)' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Schlüssel</th>
                <th>Meldung</th>
              </tr>
            </thead>
            <tbody>
              {validation?.checks.map((check) => (
                <tr key={check.key}>
                  <td data-label="Status">{statusLabel(check.status)}</td>
                  <td data-label="Schlüssel"><code>{check.key}</code></td>
                  <td data-label="Meldung">{check.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
