'use client';

import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, FormField } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';
import { localizeAuthError, useI18n } from '../../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

/**
 * AP-16: local registration. Creates an account with status PENDING_APPROVAL;
 * only an administrator approves it (POST /admin/users/:id/approve).
 * The response contains no account details, only the approval status.
 */
export default function RegisterPage(): ReactElement {
  const apiBaseUrl = getApiBaseUrl();
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
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

      const data = await res.json().catch(() => null);
      
      // Handle structured validation errors (BugFix-02)
      // New format: { message: 'Validierung fehlgeschlagen', errors: [{ field, constraint, message }], statusCode: 400 }
      if (data?.errors && Array.isArray(data.errors) && data.errors[0]?.field) {
        const newFieldErrors: Record<string, string> = {};
        data.errors.forEach((err: { field: string; message: string }) => {
          // Map API field names to form field names
          const fieldName = err.field === 'username' ? 'username' : 
                           err.field === 'displayName' ? 'displayName' : 
                           err.field === 'password' ? 'password' : 'general';
          if (!newFieldErrors[fieldName]) {
            newFieldErrors[fieldName] = err.message;
          }
        });
        setFieldErrors(newFieldErrors);
        setError(data.message || t('auth.validationError'));
      } else if (data?.errors && Array.isArray(data.errors)) {
        // Legacy format: array of strings
        const newFieldErrors: Record<string, string> = {};
        data.errors.forEach((err: string) => {
          // Try to map error messages to fields
          if (err.toLowerCase().includes('username') || err.toLowerCase().includes('benutzername')) {
            newFieldErrors.username = err;
          } else if (err.toLowerCase().includes('displayname') || err.toLowerCase().includes('anzeigename')) {
            newFieldErrors.displayName = err;
          } else if (err.toLowerCase().includes('password') || err.toLowerCase().includes('passwort')) {
            newFieldErrors.password = err;
          } else {
            // Generic error
            if (!newFieldErrors.general) newFieldErrors.general = err;
          }
        });
        setFieldErrors(newFieldErrors);
        setError(data.message || t('auth.validationError'));
      } else {
        // AP-21: the raw (German) API error message is NOT displayed; the
        // HTTP status is mapped to a localized catalog key (en/de).
        setError(localizeAuthError(t, res.status, 'register'));
      }
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
              error={fieldErrors.username}
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

            <FormField label={t('auth.displayName')} required hint={t('auth.displayNameHint')} error={fieldErrors.displayName}>
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

            <FormField label={t('auth.password')} required hint={t('auth.passwordHint')} error={fieldErrors.password}>
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

            {fieldErrors.general && (
              <div style={{ marginTop: 'var(--versigo-space-3)', padding: 'var(--versigo-space-2)', background: 'var(--versigo-danger-soft)', borderRadius: 'var(--versigo-radius)', color: 'var(--versigo-danger)', fontSize: 'var(--versigo-text-sm)' }}>
                {fieldErrors.general}
              </div>
            )}

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
