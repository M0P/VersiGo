'use client';

import type { ReactElement } from 'react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/alert';

/**
 * AP-16: Seite fuer verbotene Zugriffe (403). Wird angezeigt, wenn eine
 * Seite oder API-Aktion fuer die Rolle des Users nicht zulaessig ist
 * (z. B. READ_ONLY bei Admin-Seiten). Die eigentliche Durchsetzung
 * erfolgt serverseitig; diese Seite ist nur die UX-Ebene.
 */
export default function ForbiddenPage(): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--insura-space-4)' }}>
      <Card style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--insura-space-6)' }}>
          <h1 style={{ marginBottom: 'var(--insura-space-1)' }}>
            <span style={{ color: 'var(--insura-accent)' }}>In</span>sura
          </h1>
          <p className="text-muted">Zugriff verweigert</p>
        </div>

        <Alert variant="danger" title="Zugriff verweigert">
          Ihr Konto hat fuer diese Aktion nicht die erforderliche Berechtigung.
          Falls Sie einen Fehler vermuten, wenden Sie sich an Ihre Administration.
        </Alert>

        <div style={{ display: 'flex', gap: 'var(--insura-space-3)', marginTop: 'var(--insura-space-6)' }}>
          <a href="/" style={{ flex: 1, textDecoration: 'none' }}>
            <Button variant="outline" style={{ width: '100%' }}>Zur Startseite</Button>
          </a>
          <a href="/login" style={{ flex: 1, textDecoration: 'none' }}>
            <Button style={{ width: '100%' }}>Anmelden</Button>
          </a>
        </div>
      </Card>
    </div>
  );
}
