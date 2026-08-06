'use client';

import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { AppShell } from '../../components/ui/app-shell';
import { PageHeader, SectionHeader } from '../../components/ui/page-header';
import { Card, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input, FormField } from '../../components/ui/form-field';
import { Alert } from '../../components/ui/alert';
import { Loading, InlineSpinner } from '../../components/ui/loading';
import { NAV_SECTIONS } from '../../components/ui/nav-config';
import { AppearanceSettings } from '../../components/ui/appearance-settings';
import { LanguageSelector } from '../../components/ui/language-selector';
import { useCurrentUser } from '../../hooks/use-current-user';
import { formatDate, useI18n } from '../../i18n';

import { getApiBaseUrl } from '@/lib/runtime-config';

const API_BASE = getApiBaseUrl();

type Profile = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
};

// BugFix-07 (Q2): Zustand der Self-Service-OIDC-Verknuepfung (GET /auth/oidc/link)
type OidcLinkStatus = {
  linked: boolean;
  oidcIssuer: string | null;
  oidcSubject: string | null;
  oidcReady: boolean;
  oidcError: string | null;
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
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  // BugFix-07 (Q2): OIDC-Verknuepfung
  const [oidcStatus, setOidcStatus] = useState<OidcLinkStatus | null>(null);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [oidcMessage, setOidcMessage] = useState<string | null>(null);

  const loadOidcStatus = () => {
    fetch(`${API_BASE}/auth/oidc/link`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return Promise.resolve(null); }
        if (!res.ok) return Promise.resolve(null);
        return res.json();
      })
      .then((data: OidcLinkStatus | null) => {
        if (data) setOidcStatus(data);
      })
      .catch(() => setOidcStatus(null));
  };

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

  // BugFix-07: Nach dem Link-Callback (Redirect von /auth/callback) stehen
  // Ergebnis und Fehler als Query-Parameter auf /settings bereit.
  const readOidcCallbackResult = (): string | null => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('oidc') === 'linked') return t('settings.oidcLinkSuccess');
    if (params.get('error') === 'oidc-link-conflict') return t('settings.oidcLinkConflict');
    if (params.get('error') === 'oidc-link-failed') return t('settings.oidcLinkFailed');
    return null;
  };

  useEffect(() => {
    if (userLoading) return;
    if (user?.role === 'READ_ONLY') return;
    loadProfile();
    loadOidcStatus();
    setOidcMessage(readOidcCallbackResult());
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

  // BugFix-07 (Q2): Self-Service-OIDC-Verknuepfung. POST startet den
  // Link-Flow (Session merkt sich den Link-Modus) und liefert die
  // Provider-URL; der User wird dorthin geleitet und kommt nach der
  // Bestaetigung ueber /auth/callback (Link-Modus) zurueck.
  const handleLinkOidc = async () => {
    setLinking(true);
    setOidcMessage(null);
    try {
      const res = await fetch(`${API_BASE}/auth/oidc/link`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 501) {
        setOidcMessage(t('settings.oidcNotReady'));
        return;
      }
      if (!res.ok) throw new Error(t('settings.oidcLinkFailed'));
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(t('settings.oidcLinkFailed'));
    } catch {
      setOidcMessage(t('settings.oidcLinkFailed'));
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkOidc = async () => {
    if (!window.confirm(t('settings.oidcUnlinkButton') + '?')) return;
    setUnlinking(true);
    setOidcMessage(null);
    try {
      const res = await fetch(`${API_BASE}/auth/oidc/link`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('settings.oidcLinkFailed'));
      setOidcMessage(t('settings.oidcUnlinkSuccess'));
      await loadOidcStatus();
    } catch {
      setOidcMessage(t('settings.oidcLinkFailed'));
    } finally {
      setUnlinking(false);
    }
  };

  // AP-20 (UI-Completeness): DSGVO-Export der eigenen personenbezogenen
  // Daten (GET /privacy/export, AP-19 API). Das JSON wird als Datei
  // heruntergeladen – der Server liefert bewusst kein File-Stream, sondern
  // strukturierte Daten (PrivacyExport).
  const handleExport = async () => {
    setExporting(true);
    setExported(false);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/privacy/export`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (res.status === 403) { window.location.href = '/forbidden'; return; }
      if (!res.ok) throw new Error(t('settings.exportError'));
      const data: unknown = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `versigo-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.unknownError'));
    } finally {
      setExporting(false);
    }
  };

  // AP-20 (UI-Completeness): Konto-Loeschen ist ueber die Einstellungsseite
  // erreichbar (DELETE /privacy/account). Nur USER/ADMIN duerfen es – die
  // READ_ONLY-Ansicht oben hat diesen Abschnitt nicht. Der Server schuetzt
  // den letzten aktiven Administrator (409).
  const handleDeleteAccount = async () => {
    if (!window.confirm(t('settings.deleteAccountConfirm'))) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/privacy/account`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('settings.deleteAccountLastAdmin'));
      }
      if (!res.ok) throw new Error(t('settings.deleteAccountError'));
      // Konto ist geloescht; zurueck zur Anmeldung (Session existiert nicht
      // mehr – ein Folgerequest wuerde ohnehin 401 liefern).
      window.location.href = '/login';
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.unknownError'));
    } finally {
      setDeleting(false);
    }
  };

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

          {/* BugFix-07 (Q2): Self-Service-OIDC-Verknuepfung. Zustand kommt
              von GET /auth/oidc/link; das Ergebnis des Link-Callbacks wird
              ueber die Query-Parameter von /settings angezeigt. */}
          <Card style={{ marginTop: 'var(--versigo-space-6)' }}>
            <CardHeader>
              <SectionHeader title={t('settings.oidcLinkTitle')} />
            </CardHeader>
            <p style={{ marginBottom: 'var(--versigo-space-4)' }}>
              {t('settings.oidcLinkBody')}
            </p>

            {oidcMessage && (
              <div style={{ marginBottom: 'var(--versigo-space-4)' }}>
                <Alert variant={oidcMessage === t('settings.oidcLinkSuccess') || oidcMessage === t('settings.oidcUnlinkSuccess') ? 'success' : 'warning'}>
                  {oidcMessage}
                </Alert>
              </div>
            )}

            {oidcStatus?.linked && oidcStatus.oidcIssuer ? (
              <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ flex: 1 }}>
                  {t('settings.oidcLinked', { issuer: oidcStatus.oidcIssuer })}
                </span>
                <Button variant="secondary" onClick={handleUnlinkOidc} disabled={unlinking}>
                  {unlinking ? <><InlineSpinner /> {t('settings.oidcUnlinkButton')}</> : t('settings.oidcUnlinkButton')}
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--versigo-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  {oidcStatus && !oidcStatus.oidcReady && (
                    <p className="text-sm text-muted" style={{ margin: 0 }}>
                      {t('settings.oidcNotReady')}
                    </p>
                  )}
                </div>
                <Button
                  variant="primary"
                  onClick={handleLinkOidc}
                  disabled={linking || (oidcStatus !== null && !oidcStatus.oidcReady)}
                >
                  {linking ? <><InlineSpinner /> {t('settings.oidcLinkButton')}</> : t('settings.oidcLinkButton')}
                </Button>
              </div>
            )}
          </Card>

          {/* AP-20 (UI-Completeness): DSGVO-Export (GET /privacy/export).
              Nur USER/ADMIN – die READ_ONLY-Ansicht oben hat diesen
              Abschnitt nicht. Der Server liefert ausschliesslich Daten des
              eigenen Kontos. */}
          <Card style={{ marginTop: 'var(--versigo-space-6)' }}>
            <CardHeader>
              <SectionHeader title={t('settings.exportTitle')} />
            </CardHeader>
            <p style={{ marginBottom: 'var(--versigo-space-4)' }}>
              {t('settings.exportBody')}
            </p>
            {exported && (
              <div style={{ marginBottom: 'var(--versigo-space-4)' }}>
                <Alert variant="success">{t('settings.exportSuccess')}</Alert>
              </div>
            )}
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>
              {exporting ? t('settings.exporting') : t('settings.exportButton')}
            </Button>
          </Card>

          {/* AP-20 (UI-Completeness): Gefahrenzone – Konto dauerhaft loeschen.
              Bewusst getrennte Karte am Seitenende, damit ein versehentlicher
              Klick unwahrscheinlich bleibt (zusaeztlich window.confirm). */}
          <Card
            style={{
              marginTop: 'var(--versigo-space-6)',
              borderColor: 'var(--versigo-danger)',
            }}
          >
            <CardHeader>
              <SectionHeader title={t('settings.deleteAccountTitle')} />
            </CardHeader>
            <p style={{ marginBottom: 'var(--versigo-space-4)' }}>
              {t('settings.deleteAccountBody')}
            </p>
            <Button variant="danger" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting ? t('settings.deletingAccount') : t('settings.deleteAccountButton')}
            </Button>
          </Card>
        </>
      )}
    </AppShell>
  );
}
