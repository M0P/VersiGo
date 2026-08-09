import type { IconName } from './icons';

/**
 * Shared navigation configuration for the app shell.
 * Each section groups related routes.
 *
 * `label` contains i18n keys since AP-21 (nav.*); the translation
 * happens in the AppShell (useI18n). Thus the configuration stays a
 * pure, testable data structure.
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
      // AP-20: the sharing feature is reachable via the UI
      // (household-scoped shares of other family members).
      { href: '/household/shares', label: 'nav.shares', icon: 'sharing' },
    ],
  },
  {
    label: 'nav.administration',
    items: [
      // AP-17: /settings is the personal profile page ("my profile").
      // The central system settings live under /admin/settings
      // and are visible only to ADMIN (enforced server-side).
      { href: '/settings', label: 'nav.myProfile', icon: 'settings' },
      { href: '/admin', label: 'nav.admin', icon: 'admin' },
      // BugFix-07 (Q1): the feature management (AI, OIDC, Paperless, storage,
      // family sharing) is integrated in /admin/settings; /admin/features
      // redirects there.
      { href: '/admin/settings', label: 'nav.adminSettings', icon: 'settings' },
      // BugFix-02: admin user management
      { href: '/admin/users', label: 'nav.adminUsers', icon: 'users' },
      // BugFix-04: audit log + monitoring (previously API-only, now UI)
      { href: '/admin/audit', label: 'nav.audit', icon: 'audit' },
      { href: '/admin/monitoring', label: 'nav.monitoring', icon: 'monitoring' },
    ],
  },
];
