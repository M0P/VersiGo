'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Loading } from '../../../components/ui/loading';
import { Alert } from '../../../components/ui/alert';
import { EmptyState } from '../../../components/ui/empty-state';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';
import CoverageSummarySection from './coverage-summary-section';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type PolicyDetail = {
  id: string;
  type: string;
  insurerName: string;
  insurerPortalUrl: string | null;
  contractNumber: string;
  tariffName: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  renewalDate: string | null;
  noticePeriod: number | null;
  paymentFrequency: string | null;
  premiumAmount: number | null;
  deductibleAmount: number | null;
  coverageSummaryShort: string | null;
  source: string;
  createdAt: string;
  archivedAt: string | null;
  coveredPersons: { id: string; personName: string; relationType: string }[];
  portalLinks: { id: string; providerKey: string; portalUrl: string | null }[];
};

export default function PolicyDetailPage(): ReactElement {
  const params = useParams();
  const policyId = params.id as string;
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/households/default/policies/${policyId}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Nicht gefunden');
        return res.json();
      })
      .then((data) => { if (data) setPolicy(data); })
      .catch(() => setPolicy(null))
      .finally(() => setLoading(false));
  }, [policyId]);

  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <Loading label="Lade Versicherungsdetails..." />
      </AppShell>
    );
  }

  if (!policy) {
    return (
      <AppShell navSections={NAV_SECTIONS}>
        <PageHeader title="Versicherung" />
        <Alert variant="danger">Versicherung nicht gefunden.</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader
        title={policy.insurerName}
        description={`${policy.type} • ${policy.status}`}
        actions={
          <a href="/policies">
            <Button variant="secondary" size="sm">Zurück zur Übersicht</Button>
          </a>
        }
      />

      <div className="split-layout">
        <Card>
          <SectionHeader title="Stammdaten" />
          <dl style={{ margin: 0 }}>
            <dt className="text-xs text-muted" style={{ marginTop: 'var(--insura-space-2)' }}>Vertragsnummer</dt>
            <dd style={{ margin: 0 }}>{policy.contractNumber}</dd>

            {policy.tariffName && (
              <>
                <dt className="text-xs text-muted" style={{ marginTop: 'var(--insura-space-2)' }}>Tarif</dt>
                <dd style={{ margin: 0 }}>{policy.tariffName}</dd>
              </>
            )}

            <dt className="text-xs text-muted" style={{ marginTop: 'var(--insura-space-2)' }}>Status</dt>
            <dd style={{ margin: 0 }}>
              <span className={`badge ${policy.status === 'ACTIVE' ? 'badge-success' : policy.status === 'CANCELLED' ? 'badge-warning' : 'badge-neutral'}`}>
                {policy.status}
              </span>
            </dd>

            <dt className="text-xs text-muted" style={{ marginTop: 'var(--insura-space-2)' }}>Beginn</dt>
            <dd style={{ margin: 0 }}>{new Date(policy.startDate).toLocaleDateString()}</dd>

            {policy.endDate && (
              <>
                <dt className="text-xs text-muted" style={{ marginTop: 'var(--insura-space-2)' }}>Ende</dt>
                <dd style={{ margin: 0 }}>{new Date(policy.endDate).toLocaleDateString()}</dd>
              </>
            )}

            {policy.premiumAmount != null && (
              <>
                <dt className="text-xs text-muted" style={{ marginTop: 'var(--insura-space-2)' }}>Prämie</dt>
                <dd style={{ margin: 0 }}>{policy.premiumAmount} EUR</dd>
              </>
            )}
          </dl>
        </Card>

        <Card>
          <SectionHeader title="Versicherte Personen" />
          {policy.coveredPersons.length === 0 ? (
            <EmptyState icon="👤" title="Keine Personen">
              <p>Keine Personen eingetragen.</p>
            </EmptyState>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--insura-space-4)' }}>
              {policy.coveredPersons.map((p) => (
                <li key={p.id}>{p.personName} ({p.relationType})</li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Portal-Links" />
          {policy.portalLinks.length === 0 ? (
            <EmptyState icon="🔗" title="Keine Links">
              <p>Keine Portal-Links vorhanden.</p>
            </EmptyState>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--insura-space-4)' }}>
              {policy.portalLinks.map((l) => (
                <li key={l.id}>
                  {l.providerKey}
                  {l.portalUrl && (
                    <a href={l.portalUrl} style={{ marginLeft: 'var(--insura-space-2)' }}>
                      Portal öffnen
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 'var(--insura-space-6)' }}>
        <CoverageSummarySection householdId="default" policyId={policyId} />
      </div>
    </AppShell>
  );
}
