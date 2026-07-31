'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Summary = {
  totalAnnualGross: number;
  perType: Record<string, number>;
  policyCount: number;
};

const typeLabels: Record<string, string> = {
  HAFTPFLICHT: 'Haftpflicht',
  HAUSRAT: 'Hausrat',
  RECHTSSCHUTZ: 'Rechtsschutz',
  KFZ: 'KFZ',
  WOHNGEBAEUDE: 'Wohngebäude',
  UNFALL: 'Unfall',
  LEBEN: 'Leben',
  BERUFSUNFAEHIGKEIT: 'Berufsunfähigkeit',
  SONSTIGE: 'Sonstige',
};

export default function HouseholdCostsPage(): ReactElement {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/costs/summary`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler');
        return res.json();
      })
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Kostenübersicht" />
        <Loading label="Lade Kostenübersicht..." />
      </AppShell>
    );
  }

  if (!summary) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Kostenübersicht" />
        <Alert variant="warning">Übersicht nicht verfügbar.</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title="Kostenübersicht"
        description="Ihre Versicherungskosten auf einen Blick"
        actions={
          <a href="/policies">
            <Button variant="secondary" size="sm">Zu den Versicherungen</Button>
          </a>
        }
      />

      <div className="split-layout" style={{ marginBottom: 'var(--insura-space-6)' }}>
        <Card>
          <h3>Gesamt (jährlich)</h3>
          <p style={{ fontSize: 'var(--insura-font-size-3xl)', fontWeight: 'var(--insura-font-weight-bold)', color: 'var(--insura-accent)', margin: 0 }}>
            {summary.totalAnnualGross.toFixed(2)} EUR
          </p>
        </Card>
        <Card>
          <h3>Anzahl Versicherungen</h3>
          <p style={{ fontSize: 'var(--insura-font-size-3xl)', fontWeight: 'var(--insura-font-weight-bold)', color: 'var(--insura-accent)', margin: 0 }}>
            {summary.policyCount}
          </p>
        </Card>
      </div>

      <Card>
        <SectionHeader title="Aufschluss nach Versicherungstyp" />
        {Object.keys(summary.perType).length === 0 ? (
          <p className="text-muted">Keine Daten.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Typ</th>
                  <th>Jährliche Kosten</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.perType).map(([type, amount]) => (
                  <tr key={type}>
                    <td data-label="Typ">{typeLabels[type] ?? type}</td>
                    <td data-label="Jährliche Kosten">{amount.toFixed(2)} EUR</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
