'use client';

import type { ReactElement } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';

/**
 * AP-16: Seite fuer Konten im Status PENDING_APPROVAL. Ein noch nicht
 * freigeschaltetes Konto kann sich nicht anmelden (der API-Login liefert
 * generische Fehler); diese Seite erklaert den Freischaltungsprozess.
 * Die Statuspruefung fragt /auth/me ab – sobald das Konto aktiv ist,
 * wird zur Startseite weitergeleitet.
 */
export default function PendingPage(): ReactElement {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  async function checkStatus(): Promise<void> {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/me`, { credentials: 'include' });
      if (res.ok) {
        window.location.href = '/';
      } else {
        window.location.href = '/login';
      }
    } catch {
      window.location.href = '/login';
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
      <Card style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--versigo-space-6)' }}>
          <h1 style={{ marginBottom: 'var(--versigo-space-1)' }}>
            <span style={{ color: 'var(--versigo-accent)' }}>Ver</span>siGo
          </h1>
          <p className="text-muted">Konto noch nicht freigeschaltet</p>
        </div>

        <Alert variant="info" title="Freischaltung ausstehend">
          Ihr Konto wurde noch nicht durch einen Administrator freigeschaltet.
          Sie koennen sich erst anmelden, sobald Ihr Konto den Status
          &bdquo;aktiv&ldquo; hat. Bitte versuchen Sie es spaeter erneut.
        </Alert>

        <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', marginTop: 'var(--versigo-space-6)' }}>
          <a href="/login" style={{ flex: 1, textDecoration: 'none' }}>
            <Button variant="outline" style={{ width: '100%' }}>Zur Anmeldung</Button>
          </a>
          <Button style={{ flex: 1 }} onClick={() => void checkStatus()}>
            <InlineSpinner /> Status pruefen
          </Button>
        </div>
      </Card>
    </div>
  );
}
