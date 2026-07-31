'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '../../contexts/theme-context';
import { Icon } from './icons';
import type { NavSection } from './nav-config';

type AppShellProps = {
  children: ReactNode;
  navSections: NavSection[];
  /** If true, the main content area uses full width. */
  wide?: boolean;
};

/**
 * Responsive application shell with sidebar navigation (desktop),
 * top bar with toggle (mobile), and content area.
 *
 * The sidebar is shown on tablet+ and hidden by default on mobile.
 * A hamburger toggle in the topbar opens/closes the sidebar overlay on mobile.
 */
export function AppShell({ children, navSections, wide = false }: AppShellProps): ReactElement {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { toggleTheme, theme } = useTheme();

  const closeSidebar = () => setSidebarOpen(false);

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
          aria-label={sidebarOpen ? 'Navigation schliessen' : 'Navigation öffnen'}
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
          <span className="logo-accent">In</span>sura
        </Link>
        <div className="app-topbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={toggleTheme}
            aria-label={`Wechsel zu ${theme === 'light' ? 'dunklem' : 'hellem'} Modus`}
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
          <span className="logo-accent">In</span>sura
        </Link>

        {navSections.map((section) => (
          <div key={section.label}>
            <div className="nav-section-label">{section.label}</div>
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
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <main className={`app-main ${wide ? 'app-main-wide' : ''}`}>
        {children}
      </main>
    </div>
  );
}
