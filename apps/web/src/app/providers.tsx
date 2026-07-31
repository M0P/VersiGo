'use client';

import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '../contexts/theme-context';

/**
 * Client-side provider wrapper used in the root layout.
 * Keeps the root layout as a server component while allowing
 * client-side context for the design system theme.
 */
export function Providers({ children }: { children: ReactNode }): ReactElement {
  return <ThemeProvider>{children}</ThemeProvider>;
}
