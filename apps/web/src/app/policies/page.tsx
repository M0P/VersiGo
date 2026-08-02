'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/ui/loading';
import { Alert } from '../../components/ui/alert';
import { EmptyState } from '../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../components/ui/nav-config';

type Policy = {
  id: string;
  type: string;
  insurerName: string;
  contractNumber: string;
  status: string;
  premiumAmount: number | null;
  startDate: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const statusLabels: Record<string, string> = {
  ACTIVE: 'Aktiv',
  CANCELLED: 'Gekündigt',
  EXPIRED: 'Abgelaufen',
  ARCHIVED: 'Archiviert',
};

export default function PolicyListPage(): ReactElement {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/policies`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler beim Laden');
        return res.json();
      })
      .then((data) => { if (data) setPolicies(data); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Versicherungen" />
        <Loading label="Lade Versicherungen..." />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Versicherungen" />
        <Alert variant="danger">Fehler: {error}</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title="Versicherungen"
        description="Alle Ihre Versicherungsverträge auf einen Blick"
        actions={<a href="/policies/new"><Button variant="primary">Neue Versicherung</Button></a>}
      />

      {policies.length === 0 ? (
        <EmptyState icon="📋" title="Keine Versicherungen">
          <p>Sie haben noch keine Versicherungen erfasst.</p>
          <a href="/policies/new"><Button variant="primary">Erste Versicherung anlegen</Button></a>
        </EmptyState>
      ) : (
        <div className="split-layout">
          {policies.map((p) => (
            <Card key={p.id}>
              <h3>{p.insurerName}</h3>
              <p className="text-sm text-muted">{p.type}</p>
              <p className="text-sm">
                Status: <span className={`badge ${p.status === 'ACTIVE' ? 'badge-success' : p.status === 'CANCELLED' ? 'badge-warning' : 'badge-neutral'}`}>
                  {statusLabels[p.status] ?? p.status}
                </span>
              </p>
              {p.premiumAmount != null && (
                <p className="text-sm">Prämie: {p.premiumAmount.toFixed(2)} EUR</p>
              )}
              <div style={{ marginTop: 'var(--versigo-space-3)' }}>
                <a href={`/policies/${p.id}`}>
                  <Button variant="secondary" size="sm">Details</Button>
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
