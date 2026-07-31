import type { ReactElement } from 'react';
import { Card } from '../../../components/ui/card';
import { InlineSpinner } from '../../../components/ui/loading';

/**
 * OIDC-Callback fallback page.
 * The actual OIDC callback is handled server-side by apps/api
 * (/auth/callback sets the session cookie and redirects to "/").
 * This page serves as a fallback if directly accessed.
 */
export default function CallbackPage(): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--insura-space-4)' }}>
      <Card style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <h1 style={{ marginBottom: 'var(--insura-space-2)' }}>
          <span style={{ color: 'var(--insura-accent)' }}>In</span>sura
        </h1>
        <p className="text-muted">Anmeldung wird verarbeitet...</p>
        <div style={{ marginTop: 'var(--insura-space-4)' }}>
          <InlineSpinner />
        </div>
      </Card>
    </div>
  );
}
