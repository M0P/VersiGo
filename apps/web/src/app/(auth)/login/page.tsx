'use client';

import type { FormEvent, ReactElement } from 'react';
import { useState, useEffect } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, FormField } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { localizeAuthError, oidcCallbackErrorKey, useI18n } from '../../../i18n';

type AuthConfig = {
  oidcEnabled: boolean;
  oidcReady: boolean;
  oidcConfigured: boolean;
  oidcError: string | null;
  localEnabled: boolean;
  registrationEnabled: boolean;
};

type LoginError = {
  message: string;
  status: number;
  fieldErrors?: Record<string, string>;
};

/**
 * Normalizes the middleware's redirectTo query parameter to a safe internal
 * path (open-redirect protection): only paths starting with a single "/" are
 * accepted; scheme-relative ("//host"), backslash variants ("/\\host"),
 * external schemes and invalid percent-encoding fall back to "/".
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

import { getApiBaseUrl } from '@/lib/runtime-config';

export default function LoginPage(): ReactElement {
  const apiBaseUrl = getApiBaseUrl();
  const { t } = useI18n();

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [configError, setConfigError] = useState(false);
  // Target after a successful login: the redirectTo query parameter set by
  // the middleware (sanitized) or "/".
  const [redirectTo] = useState<string>(() =>
    typeof window === 'undefined'
      ? '/'
      : safeRedirectPath(new URLSearchParams(window.location.search).get('redirectTo')),
  );
  // BugFix-18: `error` query parameter set by the API when the OIDC callback
  // failed (e.g. authentication-failed). Read after mount (window access,
  // no SSR hydration mismatch) and rendered as a localized alert.
  const [oidcErrorKey, setOidcErrorKey] = useState<string | null>(null);

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

  // BugFix-18: read the API's OIDC callback error (query parameter `error`).
  useEffect(() => {
    setOidcErrorKey(
      oidcCallbackErrorKey(new URLSearchParams(window.location.search).get('error')),
    );
  }, []);

  async function handleLocalLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);

    try {
      const res = await fetch(`${apiBaseUrl}/auth/local/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });

      if (res.ok) {
        // Honor the middleware's original target (sanitized, otherwise "/").
        window.location.href = redirectTo;
        return;
      }

      const data = await res.json().catch(() => null);
      
      // Handle structured validation errors (BugFix-02)
      if (data?.errors && Array.isArray(data.errors)) {
        const newFieldErrors: Record<string, string> = {};
        data.errors.forEach((err: string) => {
          if (err.toLowerCase().includes('username') || err.toLowerCase().includes('benutzername')) {
            newFieldErrors.username = err;
          } else if (err.toLowerCase().includes('password') || err.toLowerCase().includes('passwort')) {
            newFieldErrors.password = err;
          } else {
            if (!newFieldErrors.general) newFieldErrors.general = err;
          }
        });
        setFieldErrors(newFieldErrors);
        setError({ message: data.message || t('auth.validationError'), status: res.status, fieldErrors: newFieldErrors });
      } else {
        // AP-21: the raw (German) API error message is NOT displayed; the
        // HTTP status is mapped to a localized catalog key (en/de).
        setError({ message: localizeAuthError(t, res.status, 'login'), status: res.status });
      }
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

  const hasAnyAuth = config.oidcConfigured || config.localEnabled;

  // BugFix-07 (finding 2): OIDC is enabled as a feature, but the client
  // is not operational (discovery failed or a service restart after
  // enabling is missing). The login page then hides the button
  // and explains the state instead of a silent 501 on click.
  const oidcBroken = config.oidcConfigured && !config.oidcReady;

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

        {oidcErrorKey && (
          <Alert variant="danger" title={t('auth.loginErrorTitle')}>
            {t(oidcErrorKey)}
          </Alert>
        )}

        {config.localEnabled && (
          <form onSubmit={handleLocalLogin} noValidate>
            <fieldset disabled={loading} style={{ border: 'none', padding: 0, margin: 0 }}>
              <FormField label={t('auth.username')} required error={fieldErrors.username}>
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

              <FormField label={t('auth.password')} required error={fieldErrors.password}>
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

              {fieldErrors.general && (
                <div style={{ marginTop: 'var(--versigo-space-3)', padding: 'var(--versigo-space-2)', background: 'var(--versigo-danger-soft)', borderRadius: 'var(--versigo-radius)', color: 'var(--versigo-danger)', fontSize: 'var(--versigo-text-sm)' }}>
                  {fieldErrors.general}
                </div>
              )}

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

        {config.oidcConfigured && config.oidcReady && (
          <div style={{ textAlign: 'center' }}>
            <p className="text-sm text-muted" style={{ marginBottom: 'var(--versigo-space-3)' }}>
              {t('auth.alternativeOidc')}
            </p>
            <a href={`${apiBaseUrl}/auth/login`}>
              <Button variant="outline" style={{ width: '100%' }}>{t('auth.oidcSignIn')}</Button>
            </a>
          </div>
        )}

        {oidcBroken && (
          <div style={{ marginTop: 'var(--versigo-space-6)' }}>
            <Alert variant="warning" title={t('auth.oidcNotReadyTitle')}>
              {t('auth.oidcNotReadyBody')}
              {config.oidcError ? ` (${config.oidcError})` : ''}
            </Alert>
          </div>
        )}
      </Card>
    </div>
  );
}
