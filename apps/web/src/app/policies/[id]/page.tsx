'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';
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

  if (loading) return <main><p>Lade...</p></main>;
  if (!policy) return <main><p>Versicherung nicht gefunden.</p></main>;

  return (
    <main>
      <h1>{policy.insurerName}</h1>
      <dl>
        <dt>Typ</dt><dd>{policy.type}</dd>
        <dt>Vertragsnummer</dt><dd>{policy.contractNumber}</dd>
        <dt>Status</dt><dd>{policy.status}</dd>
        <dt>Beginn</dt><dd>{new Date(policy.startDate).toLocaleDateString()}</dd>
        {policy.endDate && <><dt>Ende</dt><dd>{new Date(policy.endDate).toLocaleDateString()}</dd></>}
        {policy.premiumAmount != null && <><dt>Praemie</dt><dd>{policy.premiumAmount} EUR</dd></>}
        {policy.coverageSummaryShort && <><dt>Deckung</dt><dd>{policy.coverageSummaryShort}</dd></>}
      </dl>

      <h2>Versicherte Personen</h2>
      {policy.coveredPersons.length === 0 && <p>Keine Personen eingetragen.</p>}
      <ul>
        {policy.coveredPersons.map((p) => (
          <li key={p.id}>{p.personName} ({p.relationType})</li>
        ))}
      </ul>

      <h2>Portal-Links</h2>
      {policy.portalLinks.length === 0 && <p>Keine Links vorhanden.</p>}
      <ul>
        {policy.portalLinks.map((l) => (
          <li key={l.id}>
            {l.providerKey}
            {l.portalUrl && <a href={l.portalUrl}> Portal oeffnen</a>}
          </li>
        ))}
      </ul>

      <CoverageSummarySection householdId="default" policyId={policyId} />

      <a href="/policies">Zurueck zur Uebersicht</a>
    </main>
  );
}
