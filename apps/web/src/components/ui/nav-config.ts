import type { IconName } from './icons';

/**
 * Shared navigation configuration for the app shell.
 * Each section groups related routes.
 *
 * `label` enthaelt seit AP-21 i18n-Schluessel (nav.*); die Uebersetzung
 * erfolgt in der AppShell (useI18n). So bleibt die Konfiguration eine
 * reine, testbare Datenstruktur.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'nav.main',
    items: [
      { href: '/', label: 'nav.dashboard', icon: 'home' },
      { href: '/policies', label: 'nav.policies', icon: 'policies' },
      { href: '/household/costs', label: 'nav.costs', icon: 'costs' },
      // AP-20: Freigaben-Funktion ist ueber die UI erreichbar
      // (household-gescopte Freigaben anderer Familienmitglieder).
      { href: '/household/shares', label: 'nav.shares', icon: 'sharing' },
    ],
  },
  {
    label: 'nav.administration',
    items: [
      // AP-17: /settings ist die persoenliche Profilseite ("Mein Profil").
      // Die zentralen Systemeinstellungen liegen unter /admin/settings
      // und sind (serverseitig durchgesetzt) nur fuer ADMIN sichtbar.
      { href: '/settings', label: 'nav.myProfile', icon: 'settings' },
      { href: '/admin', label: 'nav.admin', icon: 'admin' },
      // BugFix-02: Admin-Nutzerverwaltung
      { href: '/admin/users', label: 'nav.adminUsers', icon: 'users' },
    ],
  },
];
