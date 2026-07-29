import type { ReactElement } from 'react';
export default function LoginPage(): ReactElement {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  return (
    <main>
      <h1>Anmeldung</h1>
      <p>Melden Sie sich mit Ihrem Identity-Provider an.</p>
      <a href={`${apiBaseUrl}/auth/login`}>Mit OIDC anmelden</a>
    </main>
  );
}
