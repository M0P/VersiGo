'use client';

import { useState, type ReactElement, type FormEvent } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const POLICY_TYPES = [
  'HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ',
  'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE',
];

export default function NewPolicyPage(): ReactElement {
  const [form, setForm] = useState({
    type: 'HAFTPFLICHT',
    insurerName: '',
    contractNumber: '',
    startDate: new Date().toISOString().split('T')[0],
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/households/default/policies`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error('Fehler beim Erstellen');
      window.location.href = '/policies';
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Neue Versicherung</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Typ:
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {POLICY_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </label>
        <label>
          Versicherer:
          <input value={form.insurerName} onChange={(e) => setForm({ ...form, insurerName: e.target.value })} required />
        </label>
        <label>
          Vertragsnummer:
          <input value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} required />
        </label>
        <label>
          Beginn:
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Speichert...' : 'Erstellen'}
        </button>
      </form>
    </main>
  );
}
