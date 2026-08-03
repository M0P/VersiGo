'use client';

import type { ReactElement } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { useI18n } from '../../../i18n';

/**
 * AP-16: Seite fuer Konten im Status PENDING_APPROVAL. Ein noch nicht
 * freigeschaltetes Konto kann sich nicht anmelden (der API-Login liefert
 * generische Fehler); diese Seite erklaert den Freischaltungsprozess.
 * Die Statuspruefung fragt /auth/me ab – sobald das Konto aktiv ist,
 * wird zur Startseite weitergeleitet.
 */
import { getApiBaseUrl } from '@/lib/runtime-config';

export default function PendingPage(): ReactElement {
  const apiBaseUrl = getApiBaseUrl();
  const { t } = useI18n();

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
          <p className="text-muted">{t('auth.pendingTagline')}</p>
        </div>

        <Alert variant="info" title={t('auth.pendingTitle')}>
          {t('auth.pendingBody')}
        </Alert>

        <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', marginTop: 'var(--versigo-space-6)' }}>
          <a href="/login" style={{ flex: 1, textDecoration: 'none' }}>
            <Button variant="outline" style={{ width: '100%' }}>{t('auth.pendingToLogin')}</Button>
          </a>
          <Button style={{ flex: 1 }} onClick={() => void checkStatus()}>
            <InlineSpinner /> {t('auth.checkStatus')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
