import type { ReactElement, ReactNode } from 'react';
import '../styles/globals.css';
import { Providers } from './providers';

type RootLayoutProps = {
  children: ReactNode;
};

/**
 * Inline script that runs before first paint to restore the saved theme
 * and accent colour, preventing a flash of the default theme (FOUC).
 */
const THEME_BOOTSTRAP_SCRIPT = `(function () {
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

export default function RootLayout({
  children,
}: RootLayoutProps): ReactElement {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
