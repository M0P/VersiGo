import type { ReactElement, ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import '../styles/globals.css';
import { Providers } from './providers';
import { isSupportedLanguage, DEFAULT_LANGUAGE, type Language } from '../i18n';

// BugFix-07 (Q7b): branding via /branding/ – defaults in
// apps/web/public/branding/, overridable via the repo folder
// branding/ (rebuild required, see Dockerfile).
export const metadata: Metadata = {
  title: {
    default: 'VersiGo',
    template: '%s · VersiGo',
  },
  icons: {
    icon: '/branding/icon.svg',
    shortcut: '/branding/favicon.svg',
    apple: '/branding/icon.svg',
  },
};

type RootLayoutProps = {
  children: ReactNode;
};

/**
 * Inline script that runs before first paint to restore the saved theme,
 * accent colour, and UI language, preventing a flash of the defaults (FOUC).
 *
 * Language: the `versigo:locale` cookie is only set for accounts with a
 * persistent language preference (USER/ADMIN). Without it, English is the
 * global default; the I18nProvider reconciles with the server response
 * (including the READ_ONLY session-only language) after hydration.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function () {
  try {
    var locale = document.cookie.replace(/(?:(?:^|.*;)\\s*)versigo:locale\\s*=\\s*([^;]*).*$|.*/, '$1');
    if (locale === 'de') {
      document.documentElement.lang = 'de';
    } else {
      document.documentElement.lang = 'en';
    }
  } catch (e) {}

  try {
    var theme = localStorage.getItem('versigo:theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);

    var accent = localStorage.getItem('versigo:accent');
    if (accent) {
      var a = JSON.parse(accent);
      if (typeof a.h === 'number' && typeof a.s === 'number') {
        var root = document.documentElement;
        root.style.setProperty('--versigo-accent-h', String(a.h));
        root.style.setProperty('--versigo-accent-s', a.s + '%');
        root.style.setProperty('--versigo-accent-l', '50%');
        root.style.setProperty('--versigo-accent', 'hsl(' + a.h + ', ' + a.s + '%, 50%)');
        root.style.setProperty('--versigo-accent-light', 'hsl(' + a.h + ', ' + a.s + '%, 85%)');
        root.style.setProperty('--versigo-accent-dark', 'hsl(' + a.h + ', ' + a.s + '%, 35%)');
        root.style.setProperty('--versigo-accent-soft', 'hsl(' + a.h + ', ' + a.s + '%, 95%)');
        root.style.setProperty('--versigo-accent-text', 'hsl(' + a.h + ', ' + a.s + '%, 98%)');
        root.style.setProperty('--versigo-accent-on-dark', 'hsl(' + a.h + ', ' + a.s + '%, 90%)');
        root.style.setProperty('--versigo-focus-color', 'var(--versigo-accent)');
      }
    }
  } catch (e) {}
})();`;

export default async function RootLayout({
  children,
}: RootLayoutProps): Promise<ReactElement> {
  // The language is resolved server-side from the cookie (only set for
  // persistent accounts). Thus server HTML and the first client hydration
  // render in the same language – no hydration mismatch.
  // READ_ONLY has no cookie and starts with the global default en;
  // the session language arrives after hydration from the /user/language endpoint.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get('versigo:locale')?.value;
  const initialLanguage: Language = isSupportedLanguage(cookieValue)
    ? cookieValue
    : DEFAULT_LANGUAGE;

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        {/* Runtime config - loaded before any client code runs */}
        <script src="/runtime-config.js" />
      </head>
      <body>
        <Providers initialLanguage={initialLanguage}>{children}</Providers>
      </body>
    </html>
  );
}
