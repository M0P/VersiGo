'use client';

import { useEffect, useState, type ReactElement } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Summary = {
  totalAnnualGross: number;
  perType: Record<string, number>;
  policyCount: number;
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

  if (loading) return <main><p>Lade...</p></main>;
  if (!summary) return <main><p>Uebersicht nicht verfuegbar.</p></main>;

  const typeLabels: Record<string, string> = {
    HAFTPFLICHT: 'Haftpflicht',
    HAUSRAT: 'Hausrat',
    RECHTSSCHUTZ: 'Rechtsschutz',
    KFZ: 'KFZ',
    WOHNGEBAEUDE: 'Wohngebaeude',
    UNFALL: 'Unfall',
    LEBEN: 'Leben',
    BERUFSUNFAEHIGKEIT: 'Berufsunfaehigkeit',
    SONSTIGE: 'Sonstige',
  };

  return (
    <main>
      <h1>Kostenuebersicht</h1>
      <dl>
        <dt>Gesamt (jaerlich)</dt><dd>{summary.totalAnnualGross.toFixed(2)} EUR</dd>
        <dt>Anzahl Versicherungen</dt><dd>{summary.policyCount}</dd>
      </dl>

      <h2>Aufschluss nach Versicherungstyp</h2>
      {Object.keys(summary.perType).length === 0 && <p>Keine Daten.</p>}
      <table>
        <thead>
          <tr>
            <th>Typ</th>
            <th>Jaerliche Kosten</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(summary.perType).map(([type, amount]) => (
            <tr key={type}>
              <td>{typeLabels[type] ?? type}</td>
              <td>{amount.toFixed(2)} EUR</td>
            </tr>
          ))}
        </tbody>
      </table>

      <a href="/policies">Zu den Versicherungen</a>
    </main>
  );
}
