'use client';

import { useEffect, useState, type ReactElement } from 'react';

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

  if (loading) return <main><p>Lade Versicherungen...</p></main>;
  if (error) return <main><p>Fehler: {error}</p></main>;

  return (
    <main>
      <h1>Versicherungen</h1>
      <a href="/policies/new">Neue Versicherung</a>
      {policies.length === 0 && <p>Keine Versicherungen vorhanden.</p>}
      <ul>
        {policies.map((p) => (
          <li key={p.id}>
            <a href={`/policies/${p.id}`}>
              {p.insurerName} – {p.type} ({p.status})
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
