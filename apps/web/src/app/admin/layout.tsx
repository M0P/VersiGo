import type { ReactElement, ReactNode } from 'react';

/**
 * Minimal admin layout – the AppShell component provides all navigation.
 * This empty layout preserves the admin route group without adding
 * duplicate navigation.
 */
type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps): ReactElement {
  return <>{children}</>;
}
