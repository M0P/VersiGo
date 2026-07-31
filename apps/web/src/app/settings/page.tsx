'use client';

import { type ReactElement } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { AppearanceSettings } from '../../components/ui/appearance-settings';
import { NAV_SECTIONS } from '../../components/ui/nav-config';

export default function SettingsPage(): ReactElement {
  return (
    <AppShell navSections={NAV_SECTIONS}>
      <PageHeader title="Einstellungen" description="Personalisieren Sie Ihr Insura-Erlebnis" />
      <AppearanceSettings />
    </AppShell>
  );
}
