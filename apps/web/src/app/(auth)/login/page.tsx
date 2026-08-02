'use client';

import type { FormEvent, ReactElement } from 'react';
import { useState, useEffect } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, FormField } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { localizeAuthError, useI18n } from '../../../i18n';

type AuthConfig = {
  oidcEnabled: boolean;
  localEnabled: boolean;
  registrationEnabled: boolean;
};

type LoginError = {
  message: string;
  status: number;
};

/**
 * Normalisiert den redirectTo-Query-Parameter der Middleware zu einem
 * sicheren internen Pfad (Open-Redirect-Schutz): Nur Pfade, die mit einem
 * einzelnen "/" beginnen, werden akzeptiert; scheme-relativ ("//host"),
 * Backslash-Varianten ("/\\host"), externe Schemata und ungueltiges
 * Prozent-Encoding fallen auf "/" zurueck.
 */
function safeRedirectPath(value: string | null): string {
  if (!value) return '/';
  let path = value.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    return '/';
  }
  if (!path.startsWith('/')) return '/';
  if (path.startsWith('//') || path.startsWith('/\\') || path.startsWith('\\')) return '/';
  if (path.length > 2048) return '/';
  return path;
}

export default function LoginPage(): ReactElement {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
  const { t } = useI18n();

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [configError, setConfigError] = useState(false);
  // Ziel nach erfolgreichem Login: von der Middleware gesetzter redirectTo-
  // Query-Parameter (sanitisiert) oder "/".
  const [redirectTo] = useState<string>(() =>
    typeof window === 'undefined'
      ? '/'
      : safeRedirectPath(new URLSearchParams(window.location.search).get('redirectTo')),
  );

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
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });

      if (res.ok) {
        // Originales Ziel der Middleware ehren (sanitisiert, sonst "/").
        window.location.href = redirectTo;
        return;
      }

      // AP-21: Die rohe (deutsche) API-Fehlermeldung wird NICHT angezeigt;
      // der HTTP-Status wird auf einen lokalisierten Katalog-Schluessel
      // abgebildet (en/de).
      await res.json().catch(() => null);
      setError({ message: localizeAuthError(t, res.status, 'login'), status: res.status });
    } catch {
      setError({ message: t('auth.connectionError'), status: 0 });
    } finally {
      setLoading(false);
    }
  }

  if (configError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
        <Card style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <h1 style={{ marginBottom: 'var(--versigo-space-2)' }}>{t('auth.title')}</h1>
          <Alert variant="danger">
            {t('auth.serviceUnavailable')}
          </Alert>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
        <Card style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <h1 style={{ marginBottom: 'var(--versigo-space-2)' }}>{t('auth.title')}</h1>
          <p className="text-muted">{t('auth.loadingOptions')}</p>
          <div style={{ marginTop: 'var(--versigo-space-4)' }}>
            <InlineSpinner />
          </div>
        </Card>
      </div>
    );
  }

  const hasAnyAuth = config.oidcEnabled || config.localEnabled;

  if (!hasAnyAuth) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
        <Card style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <h1 style={{ marginBottom: 'var(--versigo-space-2)' }}>{t('auth.title')}</h1>
          <Alert variant="warning">
            {t('auth.noAuthConfigured')}
          </Alert>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
      <Card style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--versigo-space-6)' }}>
          <h1 style={{ marginBottom: 'var(--versigo-space-1)' }}>
            <span style={{ color: 'var(--versigo-accent)' }}>Ver</span>siGo
          </h1>
          <p className="text-muted">{t('auth.tagline')}</p>
        </div>

        {error && (
          <Alert variant="danger" title={t('auth.loginErrorTitle')}>
            {error.message}
          </Alert>
        )}

        {config.localEnabled && (
          <form onSubmit={handleLocalLogin} noValidate>
            <fieldset disabled={loading} style={{ border: 'none', padding: 0, margin: 0 }}>
              <FormField label={t('auth.username')} required>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder={t('auth.usernamePlaceholder')}
                />
              </FormField>

              <FormField label={t('auth.password')} required>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder={t('auth.passwordPlaceholder')}
                />
              </FormField>

              <Button type="submit" disabled={loading || !username || !password} style={{ width: '100%' }}>
                {loading ? <><InlineSpinner /> {t('auth.loggingIn')}</> : t('auth.login')}
              </Button>
            </fieldset>
          </form>
        )}

        {config.localEnabled && config.registrationEnabled && (
          <p className="text-sm text-muted" style={{ textAlign: 'center', marginTop: 'var(--versigo-space-4)' }}>
            {t('auth.noAccount')}{' '}
            <a href="/register" style={{ color: 'var(--versigo-accent)' }}>
              {t('auth.register')}
            </a>
          </p>
        )}

        {config.localEnabled && config.oidcEnabled && (
          <hr role="separator" aria-label={t('auth.or')} style={{ margin: 'var(--versigo-space-6) 0' }} />
        )}

        {config.oidcEnabled && (
          <div style={{ textAlign: 'center' }}>
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--versigo-space-3)' }}>
              {t('auth.alternativeOidc')}
            </p>
            <a href={`${apiBaseUrl}/auth/login`}>
              <Button variant="outline" style={{ width: '100%' }}>{t('auth.oidcSignIn')}</Button>
            </a>
          </div>
        )}
      </Card>
    </div>
  );
}
