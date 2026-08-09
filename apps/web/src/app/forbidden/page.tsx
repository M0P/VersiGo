'use client';

import type { ReactElement } from 'react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/alert';
import { useI18n } from '../../i18n';

/**
 * AP-16: page for forbidden accesses (403). Displayed when a page or
 * API action is not allowed for the user's role (e.g. READ_ONLY on admin
 * pages). The actual enforcement happens server-side; this page is only
 * the UX layer.
 */
export default function ForbiddenPage(): ReactElement {
  const { t } = useI18n();

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
      <Card style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--versigo-space-6)' }}>
          <h1 style={{ marginBottom: 'var(--versigo-space-1)' }}>
            <span style={{ color: 'var(--versigo-accent)' }}>Ver</span>siGo
          </h1>
          <p className="text-muted">{t('forbidden.tagline')}</p>
        </div>

        <Alert variant="danger" title={t('forbidden.title')}>
          {t('forbidden.body')}
        </Alert>

        <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', marginTop: 'var(--versigo-space-6)' }}>
          <a href="/" style={{ flex: 1, textDecoration: 'none' }}>
            <Button variant="outline" style={{ width: '100%' }}>{t('forbidden.toHome')}</Button>
          </a>
          <a href="/login" style={{ flex: 1, textDecoration: 'none' }}>
            <Button style={{ width: '100%' }}>{t('forbidden.login')}</Button>
          </a>
        </div>
      </Card>
    </div>
  );
}
