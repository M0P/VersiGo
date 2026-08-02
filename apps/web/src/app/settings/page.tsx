'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../components/ui/page-header';
import { Card, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input, FormField } from '../../components/ui/form-field';
import { Alert } from '../../components/ui/alert';
import { Loading } from '../../components/ui/loading';
import { NAV_SECTIONS } from '../../components/ui/nav-config';
import { AppearanceSettings } from '../../components/ui/appearance-settings';
import { LanguageSelector } from '../../components/ui/language-selector';
import { useCurrentUser } from '../../hooks/use-current-user';
import { formatDate, useI18n } from '../../i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Profile = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
};

export default function SettingsPage(): ReactElement {
  const { user, loading: userLoading } = useCurrentUser();
  const { t, language } = useI18n();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [displayName, setDisplayName] = useState('');
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
        if (!res.ok) throw new Error(t('settings.errorLoadingProfile'));
        return res.json();
      })
      .then((data: Profile | null) => {
        if (data) {
          setProfile(data);
          setDisplayName(data.displayName);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingProfile(false));
  };

  useEffect(() => {
    // m1: READ_ONLY-Konten duerfen das Profil nicht abrufen (403) – sie
    // sehen stattdessen die Warn-Banner-Ansicht statt eines /forbidden-
    // Redirects. `t` ist bewusst NICHT in den Dependencies: ein
    // Sprachwechsel erzeugt eine neue `t`-Referenz und wuerde sonst ein
    // redundantes GET /user/profile ausloesen (Review-2, Minor #7).
    if (userLoading) return;
    if (user?.role === 'READ_ONLY') return;
    loadProfile();
  }, [userLoading, user]);

  // AP-16/AP-17/AP-21: READ_ONLY darf KEINE Profil-/Anzeige-Einstellungen
  // veraendern; einzig die Sprachwahl ist erlaubt (session-only). Server-
  // seitig werden alle Profil-/Praeferenz-Endpunkte blockiert; hier wird
  // die editierbare Oberflaeche als UX-Ebene ausgeblendet.
  if (userLoading) {
    return (
      <AppShell navSections={NAV_SECTIONS} user={user}>
        <PageHeader title={t('settings.title')} />
        <Loading label={t('settings.loading')} />
      </AppShell>
    );
  }

  if (user?.role === 'READ_ONLY') {
    return (
      <AppShell navSections={NAV_SECTIONS} user={user}>
        <PageHeader title={t('settings.title')} description={t('settings.description')} />
        <Alert variant="warning" title={t('settings.readOnlyTitle')}>
          {t('settings.readOnlyBody')}
        </Alert>
        <div style={{ marginTop: 'var(--versigo-space-6)' }}>
          <LanguageSelector showReadOnlyNote />
        </div>
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
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('settings.errorSavingProfile'));
      }
      const updated: Profile = await res.json();
      setProfile(updated);
      setSaved(true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const profileLoading = loadingProfile || userLoading;

  return (
    <AppShell navSections={NAV_SECTIONS} user={user}>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />

      {error && <Alert variant="danger" title={t('common.error')}>{error}</Alert>}
      {saved && <Alert variant="success" title={t('settings.savedTitle')}>{t('settings.savedBody')}</Alert>}

      {profileLoading && !profile ? (
        <Loading label={t('settings.profileLoading')} />
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--versigo-space-6)' }}>
            <CardHeader>
              <SectionHeader title={t('settings.profileInfo')} />
            </CardHeader>
            {profile && (
              <div className="profile-meta">
                <div className="form-group">
                  <span className="form-label">{t('settings.username')}</span>
                  <p className="profile-meta-value">{profile.username}</p>
                </div>
                <div className="form-group">
                  <span className="form-label">{t('settings.role')}</span>
                  <p className="profile-meta-value">{profile.role}</p>
                </div>
                {profile.createdAt && (
                  <div className="form-group">
                    <span className="form-label">{t('settings.accountCreated')}</span>
                    <p className="profile-meta-value">
                      {formatDate(profile.createdAt, language)}
                    </p>
                  </div>
                )}
              </div>
            )}
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', gap: 'var(--versigo-space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <FormField label={t('settings.displayName')} hint={t('settings.displayNameHint')}>
                  <Input
                    id="profile-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={100}
                    placeholder={t('settings.displayNamePlaceholder')}
                  />
                </FormField>
              </div>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t('settings.savingProfile') : t('settings.saveProfile')}
              </Button>
            </form>
          </Card>

          {/* AP-21: Die Sprachwahl ist der zentrale LanguageSelector
              (Konto-persistent bzw. session-only); es gibt KEIN weiteres
              Locale-Feld im Profil-Formular (Review-2, Minor #2). */}
          <LanguageSelector />

          <AppearanceSettings />
        </>
      )}
    </AppShell>
  );
}
