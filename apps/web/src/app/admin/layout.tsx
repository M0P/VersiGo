import type { ReactElement, ReactNode } from 'react';

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps): ReactElement {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 220, padding: '1rem', borderRight: '1px solid #ccc' }}>
        <h2>Admin</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li><a href="/admin" style={{ display: 'block', padding: '0.5rem 0' }}>&Uuml;bersicht</a></li>
          <li><a href="/admin/settings" style={{ display: 'block', padding: '0.5rem 0' }}>Einstellungen</a></li>
          <li><a href="/admin/feature-flags" style={{ display: 'block', padding: '0.5rem 0' }}>Feature-Flags</a></li>
          <li><a href="/admin/integrations" style={{ display: 'block', padding: '0.5rem 0' }}>Integrationen</a></li>
        </ul>
      </nav>
      <main style={{ flex: 1, padding: '1rem' }}>{children}</main>
    </div>
  );
}
