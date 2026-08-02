'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../components/ui/page-header';
import { Card, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input, Select, FormField } from '../../components/ui/form-field';
import { Alert } from '../../components/ui/alert';
import { Loading } from '../../components/ui/loading';
import { NAV_SECTIONS } from '../../components/ui/nav-config';
import { AppearanceSettings } from '../../components/ui/appearance-settings';
import { useCurrentUser } from '../../hooks/use-current-user';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/** Identisch zur Allowlist der API (SUPPORTED_PROFILE_LOCALES). */
const PROFILE_LOCALES = ['de-DE', 'en-US', 'fr-FR', 'it-IT', 'es-ES', 'pt-BR'];

type Profile = {
  id: string;
  username: string;
  displayName: string;
  locale: string;
  role: string;
  createdAt: string;
};

const LOCALE_LABEL: Record<string, string> = {
  'de-DE': 'Deutsch (Deutschland)',
  'en-US': 'English (US)',
  'fr-FR': 'Français (France)',
  'it-IT': 'Italiano (Italia)',
  'es-ES': 'Español (España)',
  'pt-BR': 'Português (Brasil)',
};

export default function SettingsPage(): ReactElement {
  const { user, loading: userLoading } = useCurrentUser();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [locale, setLocale] = useState('de-DE');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = () => {
    setLoadingProfile(true);
    setError(null);
    fetch(`${API_BASE}/user/profile`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (res.status === 403) { window.location.href = '/forbidden'; return Promise.resolve(null); }
        if (!res.ok) throw new Error('Fehler beim Laden des Profils');
        return res.json();
      })
      .then((data: Profile | null) => {
        if (data) {
          setProfile(data);
          setDisplayName(data.displayName);
          if (PROFILE_LOCALES.includes(data.locale)) setLocale(data.locale);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingProfile(false));
  };

  useEffect(() => {
    // m1: READ_ONLY-Konten duerfen das Profil nicht abrufen (403) – sie
    // sehen stattdessen die Warn-Banner-Ansicht statt eines /forbidden-
    // Redirects.
    if (userLoading) return;
    if (user?.role === 'READ_ONLY') return;
    loadProfile();
  }, [userLoading, user]);

  // AP-16/AP-17: READ_ONLY darf keine Einstellungen veraendern
  // (Profil-/Theme-/Locale-Settings). Server-seitig werden alle
  // Profil-/Praeferenz-Endpunkte blockiert; hier wird die editierbare
  // Oberflaeche als UX-Ebene ausgeblendet.
  if (userLoading) {
    return (
      <AppShell navSections={NAV_SECTIONS} user={user}>
        <PageHeader title="Mein Profil" />
        <Loading label="Lade Einstellungen..." />
      </AppShell>
    );
  }

  if (user?.role === 'READ_ONLY') {
    return (
      <AppShell navSections={NAV_SECTIONS} user={user}>
        <PageHeader title="Mein Profil" description="Personalisieren Sie Ihr VersiGo-Erlebnis" />
        <Alert variant="warning" title="Nur-Lese-Zugriff">
          Ihr Konto besitzt nur Lesezugriff (READ_ONLY) und kann daher keine
          Profil- oder Anzeige-Einstellungen ändern.
        </Alert>
      </AppShell>
    );
  }

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/user/profile`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          locale,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? 'Fehler beim Speichern des Profils');
      }
      const updated: Profile = await res.json();
      setProfile(updated);
      setSaved(true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const profileLoading = loadingProfile || userLoading;

  return (
    <AppShell navSections={NAV_SECTIONS} user={user}>
      <PageHeader title="Mein Profil" description="Personalisieren Sie Ihr VersiGo-Erlebnis" />

      {error && <Alert variant="danger" title="Fehler">{error}</Alert>}
      {saved && <Alert variant="success" title="Gespeichert">Ihr Profil wurde aktualisiert.</Alert>}

      {profileLoading && !profile ? (
        <Loading label="Lade Profil..." />
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
            <CardHeader>
              <SectionHeader title="Profilinformationen" />
            </CardHeader>
            {profile && (
              <div className="profile-meta">
                <div className="form-group">
                  <span className="form-label">Benutzername</span>
                  <p className="profile-meta-value">{profile.username}</p>
                </div>
                <div className="form-group">
                  <span className="form-label">Rolle</span>
                  <p className="profile-meta-value">{profile.role}</p>
                </div>
                {profile.createdAt && (
                  <div className="form-group">
                    <span className="form-label">Konto erstellt</span>
                    <p className="profile-meta-value">
                      {new Date(profile.createdAt).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                )}
              </div>
            )}
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <FormField label="Anzeigename" hint="Wird im Dashboard und in Listen angezeigt.">
                  <Input
                    id="profile-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={100}
                    placeholder="Ihr Name"
                  />
                </FormField>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <FormField label="Sprache" hint="Beispiel: Anzeige-Sprache der Oberfläche.">
                  <Select
                    id="profile-locale"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                  >
                    {PROFILE_LOCALES.map((option) => (
                      <option key={option} value={option}>
                        {LOCALE_LABEL[option] ?? option}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Speichert…' : 'Profil speichern'}
              </Button>
            </form>
          </Card>

          <AppearanceSettings />
        </>
      )}
    </AppShell>
  );
}
