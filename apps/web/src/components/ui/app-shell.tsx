'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '../../contexts/theme-context';
import { useCurrentUser, type CurrentUser } from '../../hooks/use-current-user';
import { useI18n } from '../../i18n';
import { Icon } from './icons';
import type { NavSection } from './nav-config';

import { getApiBaseUrl, getAppVersion } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type AppShellProps = {
  children: ReactNode;
  navSections: NavSection[];
  /** If true, the main content area uses full width. */
  wide?: boolean;
  /**
   * Already loaded user (e.g. provided by the page level). When set (even to
   * null), AppShell does not trigger its own /auth/me request; without the
   * prop, AppShell loads the user itself (one fetch per page view, AP-16).
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
  // BugFix-11 (R7): the runtime version is only available client-side
  // (injected /runtime-config.js); starting from 'unknown' keeps SSR and
  // hydration in sync before the effect applies the real value.
  const [appVersion, setAppVersion] = useState('unknown');
  const pathname = usePathname();
  const { toggleTheme, theme } = useTheme();
  const { t } = useI18n();
  const hasExternalUser = userProp !== undefined;
  // No second /auth/me request when the caller already knows the user.
  const { user: hookUser } = useCurrentUser({ enabled: !hasExternalUser });
  const user = userProp !== undefined ? userProp : hookUser;

  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    setAppVersion(getAppVersion());
  }, []);

  // BugFix-05 (finding 6): family sharing is a feature flag
  // (FAMILY_SHARING_ENABLED, default true). When the flag is disabled, the UI
  // hides the /household/shares nav entry. The capability is delivered via the
  // public /ready endpoint (resolver-based, UI > ENV > DEFAULT). The initial
  // default of true prevents flickering while the request runs; on errors the
  // entry stays visible (existing behavior). Refetching on every route change
  // makes feature toggles visible during the running session (without a full
  // reload); server-side enforcement returns 403 in that case.
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

  // AP-20 (UI completeness): logout is reachable from every authenticated
  // view – an icon button in the mobile top bar and a labeled entry at the
  // bottom of the sidebar.
  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // A network error during the logout request must not block the
      // sign-out; the redirect leads to the login page anyway.
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

  // AP-16: the admin navigation is only visible to ADMIN. READ_ONLY and USER
  // do not see the admin entry (enforcement happens server-side; this is only
  // a UX measure). While the user is not loaded yet (or no valid session
  // exists), the entry is hidden too, to avoid flickering of an unauthorized
  // link.
  // BugFix-05 (finding 6): with family sharing disabled, the
  // /household/shares entry is additionally hidden.
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
        {/* Footer: minimal version line (BugFix-11/R7) */}
        <footer className="app-footer">
          <span>VersiGo {appVersion}</span>
        </footer>
      </main>
    </div>
  );
}
