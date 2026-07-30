'use client';

import type { FormEvent, ReactElement } from 'react';
import { useState, useEffect } from 'react';

type AuthConfig = {
  oidcEnabled: boolean;
  localEnabled: boolean;
};

type LoginError = {
  message: string;
  status: number;
};

export default function LoginPage(): ReactElement {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch(`${apiBaseUrl}/auth/config`);
        if (res.ok) {
          const data: AuthConfig = await res.json();
          setConfig(data);
        } else {
          setConfigError(true);
        }
      } catch {
        setConfigError(true);
      }
    }
    void fetchConfig();
  }, [apiBaseUrl]);

  async function handleLocalLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${apiBaseUrl}/auth/local/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        credentials: 'include',
      });

      if (res.ok) {
        window.location.href = '/';
        return;
      }

      const body = await res.json().catch(() => ({ message: 'Anmeldefehler' }));
      setError({ message: body.message ?? 'Anmeldefehler', status: res.status });
    } catch {
      setError({ message: 'Verbindungsfehler zum Server', status: 0 });
    } finally {
      setLoading(false);
    }
  }

  if (configError) {
    return (
      <main>
        <h1>Anmeldung</h1>
        <p role="alert">Der Anmeldedienst ist derzeit nicht verfuegbar. Bitte versuchen Sie es spaeter erneut.</p>
      </main>
    );
  }

  if (!config) {
    return (
      <main>
        <h1>Anmeldung</h1>
        <p>Lade Anmeldeoptionen...</p>
      </main>
    );
  }

  const hasAnyAuth = config.oidcEnabled || config.localEnabled;

  if (!hasAnyAuth) {
    return (
      <main>
        <h1>Anmeldung</h1>
        <p role="alert">Es ist keine Anmeldeart konfiguriert. Bitte wenden Sie sich an Ihre Administration.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Anmeldung</h1>

      {error && (
        <div role="alert" style={{ color: 'red', marginBottom: '1rem' }}>
          {error.message}
        </div>
      )}

      {config.localEnabled && (
        <form onSubmit={handleLocalLogin} noValidate>
          <fieldset disabled={loading}>
            <legend>Mit Benutzername anmelden</legend>

            <div>
              <label htmlFor="login-identifier">Benutzername</label>
              <br />
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="login-password">Passwort</label>
              <br />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-required="true"
              />
            </div>

            <div>
              <button type="submit" disabled={loading || !identifier || !password}>
                {loading ? 'Anmelden...' : 'Anmelden'}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {config.localEnabled && config.oidcEnabled && (
        <hr role="separator" aria-label="oder" />
      )}

      {config.oidcEnabled && (
        <div>
          <p>Alternativ mit Ihrem Identity-Provider anmelden:</p>
          <a href={`${apiBaseUrl}/auth/login`}>Mit OIDC anmelden</a>
        </div>
      )}
    </main>
  );
}
