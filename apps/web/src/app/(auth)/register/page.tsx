'use client';

import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, FormField } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { localizeAuthError, useI18n } from '../../../i18n';

/**
 * AP-16: Lokale Registrierung. Legt ein Konto mit Status PENDING_APPROVAL an;
 * erst ein Administrator schaltet es frei (POST /admin/users/:id/approve).
 * Die Antwort enthaelt keine Account-Details, nur den Freischaltungsstatus.
 */
export default function RegisterPage(): ReactElement {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${apiBaseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password }),
        credentials: 'include',
      });

      if (res.ok) {
        setSubmitted(true);
        return;
      }

      // AP-21: Die rohe (deutsche) API-Fehlermeldung wird NICHT angezeigt;
      // der HTTP-Status wird auf einen lokalisierten Katalog-Schluessel
      // abgebildet (en/de).
      await res.json().catch(() => null);
      setError(localizeAuthError(t, res.status, 'register'));
    } catch {
      setError(t('auth.connectionError'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--versigo-space-4)' }}>
        <Card style={{ maxWidth: 420, width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 'var(--versigo-space-6)' }}>
            <h1 style={{ marginBottom: 'var(--versigo-space-1)' }}>
              <span style={{ color: 'var(--versigo-accent)' }}>Ver</span>siGo
            </h1>
            <p className="text-muted">{t('auth.registerTagline')}</p>
          </div>
          <Alert variant="success" title={t('auth.registerSuccessTitle')}>
            {t('auth.registerSuccessBody')}
          </Alert>
          <p style={{ textAlign: 'center', marginTop: 'var(--versigo-space-4)' }}>
            <a href="/login" style={{ color: 'var(--versigo-accent)' }}>
              {t('auth.backToLogin')}
            </a>
          </p>
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
          <p className="text-muted">{t('auth.registerTagline')}</p>
        </div>

        {error && (
          <Alert variant="danger" title={t('auth.registrationFailedTitle')}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleRegister} noValidate>
          <fieldset disabled={loading} style={{ border: 'none', padding: 0, margin: 0 }}>
            <FormField
              label={t('auth.username')}
              required
              hint={t('auth.usernameHint')}
            >
              <Input
                id="register-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={t('auth.usernamePlaceholderRegister')}
              />
            </FormField>

            <FormField label={t('auth.displayName')} required hint={t('auth.displayNameHint')}>
              <Input
                id="register-displayname"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={80}
                placeholder={t('auth.displayNamePlaceholder')}
              />
            </FormField>

            <FormField label={t('auth.password')} required hint={t('auth.passwordHint')}>
              <Input
                id="register-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                placeholder={t('auth.passwordPlaceholder')}
              />
            </FormField>

            <Button
              type="submit"
              disabled={loading || !username || !displayName || !password}
              style={{ width: '100%' }}
            >
              {loading ? <><InlineSpinner /> {t('auth.registering')}</> : t('auth.createAccount')}
            </Button>
          </fieldset>
        </form>

        <p className="text-sm text-muted" style={{ textAlign: 'center', marginTop: 'var(--versigo-space-4)' }}>
          {t('auth.alreadyActivated')}{' '}
          <a href="/login" style={{ color: 'var(--versigo-accent)' }}>
            {t('auth.login')}
          </a>
        </p>
      </Card>
    </div>
  );
}
