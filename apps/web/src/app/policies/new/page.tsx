'use client';

import { useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../../components/ui/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, Select, FormField } from '../../../components/ui/form-field';
import { InlineSpinner } from '../../../components/ui/loading';
import { NAV_SECTIONS } from '../../../components/ui/nav-config';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const POLICY_TYPES = [
  'HAFTPFLICHT', 'HAUSRAT', 'RECHTSSCHUTZ', 'KFZ',
  'WOHNGEBAEUDE', 'UNFALL', 'LEBEN', 'BERUFSUNFAEHIGKEIT', 'SONSTIGE',
];

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
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Neue Versicherung" description="Erfassen Sie einen neuen Versicherungsvertrag" />

      <Card style={{ maxWidth: 640 }}>
        <form onSubmit={handleSubmit}>
          <FormField label="Typ" required>
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              required
            >
              {POLICY_TYPES.map((t) => (<option key={t} value={t}>{typeLabels[t] ?? t}</option>))}
            </Select>
          </FormField>

          <FormField label="Versicherer" required>
            <Input
              value={form.insurerName}
              onChange={(e) => setForm({ ...form, insurerName: e.target.value })}
              required
              placeholder="z. B. Allianz, HUK, ..."
            />
          </FormField>

          <FormField label="Vertragsnummer" required>
            <Input
              value={form.contractNumber}
              onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
              required
              placeholder="Versicherungsscheinnummer"
            />
          </FormField>

          <FormField label="Beginn" required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </FormField>

          <div style={{ marginTop: 'var(--versigo-space-6)' }}>
            <Button type="submit" disabled={submitting}>
              {submitting ? <><InlineSpinner /> Speichert...</> : 'Erstellen'}
            </Button>
          </div>
        </form>
      </Card>
    </AppShell>
  );
}
