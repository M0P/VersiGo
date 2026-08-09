'use client';

import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '../i18n';
import type { Language } from '../i18n';
import { ThemeProvider } from '../contexts/theme-context';

/**
 * Client-side provider wrapper used in the root layout.
 * Keeps the root layout as a server component while allowing
 * client-side contexts for the design system theme and the
 * UI language (AP-21).
 *
 * `initialLanguage` comes from the root layout (server), which reads the
 * `versigo:locale` cookie – thus server HTML and the first
 * client hydration agree (no hydration mismatch, no language flash
 * for persistent accounts).
 */
export function Providers({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}): ReactElement {
  return (
    <I18nProvider initialLanguage={initialLanguage}>
      <ThemeProvider>{children}</ThemeProvider>
    </I18nProvider>
  );
}
