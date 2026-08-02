'use client';

import type { ReactElement } from 'react';
import { AppShell } from '../components/ui/app-shell';
import { PageHeader } from '../components/ui/page-header';
import { Card } from '../components/ui/card';
import { NAV_SECTIONS } from '../components/ui/nav-config';
import { useI18n } from '../i18n';

export default function Page(): ReactElement {
  const { t } = useI18n();

  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title={t('dashboard.title')} description={t('dashboard.welcome')} />
      <div className="split-layout">
        <Card>
          <h3>{t('dashboard.policiesTitle')}</h3>
          <p className="text-muted text-sm">{t('dashboard.policiesDescription')}</p>
          <a href="/policies" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            {t('dashboard.goToPolicies')}
          </a>
        </Card>
        <Card>
          <h3>{t('dashboard.costsTitle')}</h3>
          <p className="text-muted text-sm">{t('dashboard.costsDescription')}</p>
          <a href="/household/costs" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            {t('dashboard.goToCosts')}
          </a>
        </Card>
        <Card>
          <h3>{t('dashboard.settingsTitle')}</h3>
          <p className="text-muted text-sm">{t('dashboard.settingsDescription')}</p>
          <a href="/settings" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            {t('dashboard.goToSettings')}
          </a>
        </Card>
      </div>
    </AppShell>
  );
}
