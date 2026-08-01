'use client';

import { type ReactElement } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { AppearanceSettings } from '../../components/ui/appearance-settings';
import { Alert } from '../../components/ui/alert';
import { Loading } from '../../components/ui/loading';
import { NAV_SECTIONS } from '../../components/ui/nav-config';
import { useCurrentUser } from '../../hooks/use-current-user';

export default function SettingsPage(): ReactElement {
  const { user, loading } = useCurrentUser();

  // AP-16: READ_ONLY darf keine Einstellungen veraendern (Profil-/Theme-/
  // Locale-Settings). Server-seitig wird PUT /user/preferences blockiert;
  // hier wird die editierbare Oberflaeche als UX-Ebene ausgeblendet.
  // Der geladene User wird an AppShell durchgereicht (kein zweiter
  // /auth/me-Request pro Seitenaufruf).
  if (loading) {
    return (
      <AppShell navSections={NAV_SECTIONS} user={user}>
        <PageHeader title="Einstellungen" />
        <Loading label="Lade Einstellungen..." />
      </AppShell>
    );
  }

  if (user?.role === 'READ_ONLY') {
    return (
      <AppShell navSections={NAV_SECTIONS} user={user}>
        <PageHeader title="Einstellungen" description="Personalisieren Sie Ihr Insura-Erlebnis" />
        <Alert variant="warning" title="Nur-Lese-Zugriff">
          Ihr Konto besitzt nur Lesezugriff (READ_ONLY) und kann daher keine
          Einstellungen aendern.
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell navSections={NAV_SECTIONS} user={user}>
      <PageHeader title="Einstellungen" description="Personalisieren Sie Ihr Insura-Erlebnis" />
      <AppearanceSettings />
    </AppShell>
  );
}
