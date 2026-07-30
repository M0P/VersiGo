'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type AnnualCost = {
  policyId: string;
  year: number;
  annualGross: number;
  annualNet: number | null;
  calculationBasis: {
    entryId: string;
    frequency: string;
    grossAmount: number;
    validFrom: string;
    validTo: string | null;
  };
};

type CostEntry = {
  id: string;
  policyId: string;
  validFrom: string;
  validTo: string | null;
  grossAmount: number;
  netAmount: number | null;
  frequency: string;
  bookingSource: string | null;
  note: string | null;
  createdAt: string;
};

export default function PolicyCostsPage(): ReactElement {
  const params = useParams();
  const policyId = params.id as string;
  const [annual, setAnnual] = useState<AnnualCost | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newEntry, setNewEntry] = useState({
    validFrom: '',
    validTo: '',
    grossAmount: '',
    netAmount: '',
    frequency: 'MONTHLY',
    note: '',
  });

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs/annual`, { credentials: 'include' }),
      fetch(`${API_BASE}/households/default/policies/${policyId}/costs`, { credentials: 'include' }),
    ])
      .then(([annualRes, entriesRes]) => {
        if (annualRes.status === 401 || entriesRes.status === 401) {
          window.location.href = '/login';
          return;
        }
        return Promise.all([
          annualRes.ok ? annualRes.json() : null,
          entriesRes.ok ? entriesRes.json() : [],
        ]).then(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ([annualData, entriesData]: [any, any]) => {
            if (annualData) setAnnual(annualData);
            setEntries(entriesData ?? []);
          },
        );
      })
      .catch(() => { setAnnual(null); setEntries([]); })
      .finally(() => setLoading(false));
  }, [policyId]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const body: Record<string, unknown> = {
      validFrom: newEntry.validFrom,
      grossAmount: parseFloat(newEntry.grossAmount),
      frequency: newEntry.frequency,
    };
    if (newEntry.validTo) body.validTo = newEntry.validTo;
    if (newEntry.netAmount !== '') body.netAmount = parseFloat(newEntry.netAmount);
    if (newEntry.note) body.note = newEntry.note;

    fetch(`${API_BASE}/households/default/policies/${policyId}/costs`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        if (!res.ok) throw new Error('Fehler beim Anlegen');
        return res.json();
      })
      .then(() => {
        window.location.reload();
      })
      .catch(() => alert('Fehler beim Anlegen der Kostenposition'))
      .finally(() => setSubmitting(false));
  }

  if (loading) return <main><p>Lade...</p></main>;

  return (
    <main>
      <h1>Kosten</h1>

      <h2>Jaeresuebersicht</h2>
      {annual ? (
        <dl>
          <dt>Jaereskosten (brutto)</dt><dd>{annual.annualGross.toFixed(2)} EUR</dd>
          {annual.annualNet != null && <><dt>Jaereskosten (netto)</dt><dd>{annual.annualNet.toFixed(2)} EUR</dd></>}
          <dt>Frequenz</dt><dd>{annual.calculationBasis.frequency}</dd>
          <dt>Berechnungsbasis</dt><dd>seit {new Date(annual.calculationBasis.validFrom).toLocaleDateString()}</dd>
        </dl>
      ) : (
        <p>Keine Kostenpositionen vorhanden.</p>
      )}

      <h2>Kostenpositionen</h2>
      {entries.length === 0 && <p>Keine Eintraege.</p>}
      <table>
        <thead>
          <tr>
            <th>Gueltig von</th>
            <th>Gueltig bis</th>
            <th>Brutto</th>
            <th>Netto</th>
            <th>Frequenz</th>
            <th>Notiz</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.validFrom).toLocaleDateString()}</td>
              <td>{e.validTo ? new Date(e.validTo).toLocaleDateString() : '-'}</td>
              <td>{Number(e.grossAmount).toFixed(2)} EUR</td>
              <td>{e.netAmount != null ? `${Number(e.netAmount).toFixed(2)} EUR` : '-'}</td>
              <td>{e.frequency}</td>
              <td>{e.note ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Neue Kostenposition</h2>
      <form onSubmit={handleCreate}>
        <div>
          <label>Gueltig von <input type="date" value={newEntry.validFrom} onChange={(e) => setNewEntry({ ...newEntry, validFrom: e.target.value })} required /></label>
        </div>
        <div>
          <label>Gueltig bis <input type="date" value={newEntry.validTo} onChange={(e) => setNewEntry({ ...newEntry, validTo: e.target.value })} /></label>
        </div>
        <div>
          <label>Bruttobetrag <input type="number" step="0.01" value={newEntry.grossAmount} onChange={(e) => setNewEntry({ ...newEntry, grossAmount: e.target.value })} required /></label>
        </div>
        <div>
          <label>Nettobetrag <input type="number" step="0.01" value={newEntry.netAmount} onChange={(e) => setNewEntry({ ...newEntry, netAmount: e.target.value })} /></label>
        </div>
        <div>
          <label>Frequenz
            <select value={newEntry.frequency} onChange={(e) => setNewEntry({ ...newEntry, frequency: e.target.value })}>
              <option value="MONTHLY">Monatlich</option>
              <option value="QUARTERLY">Vierteljaehrlich</option>
              <option value="SEMI_ANNUAL">Halbjaehrlich</option>
              <option value="ANNUAL">Jaehrlich</option>
            </select>
          </label>
        </div>
        <div>
          <label>Notiz <input type="text" value={newEntry.note} onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })} /></label>
        </div>
        <button type="submit" disabled={submitting}>{submitting ? 'Speichern...' : 'Speichern'}</button>
      </form>

      <a href={`/policies/${policyId}`}>Zurueck zur Police</a>
    </main>
  );
}
