import type { IconName } from './icons';

/**
 * Shared navigation configuration for the app shell.
 * Each section groups related routes.
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
    label: 'Hauptseiten',
    items: [
      { href: '/', label: 'Dashboard', icon: 'home' },
      { href: '/policies', label: 'Versicherungen', icon: 'policies' },
      { href: '/household/costs', label: 'Kosten', icon: 'costs' },
    ],
  },
  {
    label: 'Verwaltung',
    items: [
      { href: '/settings', label: 'Einstellungen', icon: 'settings' },
      { href: '/admin', label: 'Admin', icon: 'admin' },
    ],
  },
];
