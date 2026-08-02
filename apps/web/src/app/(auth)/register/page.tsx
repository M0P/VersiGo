'use client';

import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input, FormField } from '../../../components/ui/form-field';
import { Alert } from '../../../components/ui/alert';
import { InlineSpinner } from '../../../components/ui/loading';

/**
 * AP-16: Lokale Registrierung. Legt ein Konto mit Status PENDING_APPROVAL an;
 * erst ein Administrator schaltet es frei (POST /admin/users/:id/approve).
 * Die Antwort enthaelt keine Account-Details, nur den Freischaltungsstatus.
 */
export default function RegisterPage(): ReactElement {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

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

      const body = await res.json().catch(() => ({ message: 'Registrierung fehlgeschlagen' }));
      setError(body.message ?? 'Registrierung fehlgeschlagen');
    } catch {
      setError('Verbindungsfehler zum Server');
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
            <p className="text-muted">Registrierung</p>
          </div>
          <Alert variant="success" title="Registrierung eingegangen">
            Ihr Konto wurde angelegt und wartet auf die Freischaltung durch
            einen Administrator. Sobald Ihr Konto freigeschaltet ist, können
            Sie sich anmelden.
          </Alert>
          <p style={{ textAlign: 'center', marginTop: 'var(--versigo-space-4)' }}>
            <a href="/login" style={{ color: 'var(--versigo-accent)' }}>
              Zurück zur Anmeldung
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
          <p className="text-muted">Neues Konto erstellen</p>
        </div>

        {error && (
          <Alert variant="danger" title="Registrierung fehlgeschlagen">
            {error}
          </Alert>
        )}

        <form onSubmit={handleRegister} noValidate>
          <fieldset disabled={loading} style={{ border: 'none', padding: 0, margin: 0 }}>
            <FormField
              label="Benutzername"
              required
              hint="3-32 Zeichen: Kleinbuchstaben, Ziffern sowie . _ - (Start mit Buchstabe oder Ziffer)"
            >
              <Input
                id="register-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="z. B. maxi"
              />
            </FormField>

            <FormField label="Anzeigename" required hint="So erscheint Ihr Name in der Anwendung">
              <Input
                id="register-displayname"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={80}
                placeholder="z. B. Maxi Muster"
              />
            </FormField>

            <FormField label="Passwort" required hint="Mindestens 12 Zeichen">
              <Input
                id="register-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                placeholder="Ihr Passwort"
              />
            </FormField>

            <Button
              type="submit"
              disabled={loading || !username || !displayName || !password}
              style={{ width: '100%' }}
            >
              {loading ? <><InlineSpinner /> Registrieren...</> : 'Konto erstellen'}
            </Button>
          </fieldset>
        </form>

        <p className="text-sm text-muted" style={{ textAlign: 'center', marginTop: 'var(--versigo-space-4)' }}>
          Bereits freigeschaltet?{' '}
          <a href="/login" style={{ color: 'var(--versigo-accent)' }}>
            Anmelden
          </a>
        </p>
      </Card>
    </div>
  );
}
