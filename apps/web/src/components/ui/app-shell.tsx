'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '../../contexts/theme-context';
import { useCurrentUser, type CurrentUser } from '../../hooks/use-current-user';
import { useI18n } from '../../i18n';
import { Icon } from './icons';
import type { NavSection } from './nav-config';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type AppShellProps = {
  children: ReactNode;
  navSections: NavSection[];
  /** If true, the main content area uses full width. */
  wide?: boolean;
  /**
   * Bereits geladener User (z. B. vom Page-Level). Wenn gesetzt (auch null),
   * loest AppShell keinen eigenen /auth/me-Request aus; ohne den Prop laedt
   * AppShell den User selbst (ein Fetch pro Seitenaufruf, AP-16).
   */
  user?: CurrentUser | null;
};

/**
 * Responsive application shell with sidebar navigation (desktop),
 * top bar with toggle (mobile), and content area.
 *
 * The sidebar is shown on tablet+ and hidden by default on mobile.
 * A hamburger toggle in the topbar opens/closes the sidebar overlay on mobile.
 */
export function AppShell({ children, navSections, wide = false, user: userProp }: AppShellProps): ReactElement {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [familySharingEnabled, setFamilySharingEnabled] = useState(true);
  const pathname = usePathname();
  const { toggleTheme, theme } = useTheme();
  const { t } = useI18n();
  const hasExternalUser = userProp !== undefined;
  // Kein zweiter /auth/me-Request, wenn der Aufrufer den User bereits kennt.
  const { user: hookUser } = useCurrentUser({ enabled: !hasExternalUser });
  const user = userProp !== undefined ? userProp : hookUser;

  const closeSidebar = () => setSidebarOpen(false);

  // BugFix-05 (Befund 6): Familien-Freigaben sind ein Feature-Schalter
  // (FAMILY_SHARING_ENABLED, Default true). Ist der Schalter deaktiviert,
  // blendet die UI den Nav-Eintrag /household/shares aus. Die Capability
  // wird ueber den oeffentlichen /ready-Endpunkt geliefert (Resolver-
  // basiert, UI > ENV > DEFAULT). Der anfaengliche Default true verhindert
  // Flackern, solange der Request laeuft; bei Fehlern bleibt der Eintrag
  // sichtbar (Bestandsverhalten). Der Refetch bei jedem Routenwechsel macht
  // eine Umschaltung des Features waehrend der laufenden Session sichtbar
  // (ohne Voll-Reload); die serverseitige Durchsetzung liefert dabei 403.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/ready`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { capabilities?: Record<string, boolean> } | null) => {
        if (cancelled) return;
        if (data?.capabilities && typeof data.capabilities.familySharing === 'boolean') {
          setFamilySharingEnabled(data.capabilities.familySharing);
        }
      })
      .catch(() => {
        if (!cancelled) setFamilySharingEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // AP-20 (UI-Completeness): Abmelden ist in jeder angemeldeten Ansicht
  // direkt erreichbar – Icon-Schaltflaeche in der Mobil-Topbar und
  // beschrifteter Eintrag am unteren Rand der Sidebar.
  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // Netzwerkfehler beim Logout-Request darf die Abmeldung nicht
      // blockieren; der Redirect fuehrt ohnehin auf die Login-Seite.
    } finally {
      window.location.href = '/login';
    }
  };

  const logoutIcon = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );

  // AP-16: Die Admin-Navigation ist nur fuer ADMIN sichtbar. READ_ONLY und
  // USER sehen den Admin-Eintrag nicht (die Durchsetzung erfolgt serverseitig;
  // dies ist nur eine UX-Massnahme). Solange der User noch nicht geladen ist
  // (oder keine gueltige Session besteht), wird der Eintrag ebenfalls
  // ausgeblendet, um kein Flackern eines unberechtigten Links zu zeigen.
  // BugFix-05 (Befund 6): Bei deaktivierten Familien-Freigaben wird der
  // Eintrag /household/shares zusaetzlich ausgeblendet.
  const isAdmin = user?.role === 'ADMIN';
  const visibleSections: NavSection[] = navSections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => familySharingEnabled || item.href !== '/household/shares')
        .filter((item) =>
          isAdmin ? true : item.href !== '/admin' && !item.href.startsWith('/admin/'),
        ),
    }))
    .filter((section) => section.items.length > 0);

  // Mobile drawer: lock background scrolling and close on Escape while open.
  // Also close the drawer when the viewport crosses the desktop breakpoint,
  // so the body scroll lock is not left behind on larger screens.
  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    const mediaQuery = window.matchMedia('(min-width: 640px)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    mediaQuery.addEventListener('change', handleMediaChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, [sidebarOpen]);

  return (
    <div className="app-shell">
      {/* Top bar (visible on mobile) */}
      <div className="app-topbar">
        <button
          className="nav-toggle"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label={sidebarOpen ? t('nav.closeNavigation') : t('nav.openNavigation')}
          aria-expanded={sidebarOpen}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            {sidebarOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <Link href="/" className="app-topbar-logo" onClick={closeSidebar}>
          <span className="logo-accent">Ver</span>siGo
        </Link>
        <div className="app-topbar-actions">
          {user && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleLogout}
              aria-label={t('nav.logout')}
              title={t('nav.logout')}
            >
              {logoutIcon}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={toggleTheme}
            aria-label={t(theme === 'light' ? 'nav.themeToggleDark' : 'nav.themeToggleLight')}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {theme === 'light' ? (
                <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
              ) : (
                <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <Link href="/" className="app-sidebar-logo" onClick={closeSidebar}>
          <span className="logo-accent">Ver</span>siGo
        </Link>

        <nav className="app-sidebar-nav">
          {visibleSections.map((section) => (
            <div key={section.label}>
              <div className="nav-section-label">{t(section.label)}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={closeSidebar}
                  >
                    <span className="nav-item-icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    {t(item.label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {user && (
          <button className="nav-item nav-item-logout" onClick={handleLogout}>
            <span className="nav-item-icon">{logoutIcon}</span>
            {t('nav.logout')}
          </button>
        )}
      </aside>

      {/* Main content */}
      <main className={`app-main ${wide ? 'app-main-wide' : ''}`}>
        {children}
      </main>
    </div>
  );
}
