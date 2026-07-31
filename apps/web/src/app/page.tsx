'use client';

import type { ReactElement } from 'react';
import { AppShell } from '../components/ui/app-shell';
import { PageHeader } from '../components/ui/page-header';
import { Card } from '../components/ui/card';
import { NAV_SECTIONS } from '../components/ui/nav-config';

export default function Page(): ReactElement {
  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Dashboard" description="Willkommen bei Insura – Ihrer Versicherungsverwaltung" />
      <div className="split-layout">
        <Card>
          <h3>Versicherungen</h3>
          <p className="text-muted text-sm">Verwalten Sie Ihre Verträge an einem Ort.</p>
          <a href="/policies" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            Zu den Versicherungen
          </a>
        </Card>
        <Card>
          <h3>Kostenübersicht</h3>
          <p className="text-muted text-sm">Behalten Sie den Überblick über Ihre Ausgaben.</p>
          <a href="/household/costs" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            Zu den Kosten
          </a>
        </Card>
        <Card>
          <h3>Einstellungen</h3>
          <p className="text-muted text-sm">Passen Sie Ihr Erlebnis an.</p>
          <a href="/settings" className="btn btn-primary btn-sm" style={{ display: 'inline-flex' }}>
            Zu den Einstellungen
          </a>
        </Card>
      </div>
    </AppShell>
  );
}
