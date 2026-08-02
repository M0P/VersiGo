'use client';

import { useState, type ReactElement } from 'react';
import { useI18n, SUPPORTED_LANGUAGES } from '../../i18n';
import type { Language } from '../../i18n';
import { Card, CardHeader } from './card';
import { SectionHeader } from './page-header';
import { Select, FormField } from './form-field';
import { Alert } from './alert';

/**
 * AP-21: Sprachwahl fuer ALLE authentifizierten Rollen (READ_ONLY
 * eingeschlossen).
 *
 * - USER/ADMIN: Aenderung wird dauerhaft im Konto gespeichert.
 * - READ_ONLY:  Aenderung gilt ausschliesslich fuer die aktuelle
 *   Browser-Sitzung (session-only, keine Persistenz, kein Zugriff auf
 *   andere Einstellungen) – der Hinweis macht das transparent.
 */
export function LanguageSelector({ showReadOnlyNote = false }: { showReadOnlyNote?: boolean }): ReactElement {
  const { language, setLanguage, t, persistence } = useI18n();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (value: string) => {
    if (value !== 'en' && value !== 'de') return;
    setError(null);
    setSaved(false);
    try {
      await setLanguage(value as Language);
      setSaved(true);
    } catch {
      setError(t('common.unknownError'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <SectionHeader title={t('language.title')} />
      </CardHeader>
      <FormField label={t('language.title')} hint={t('language.hint')}>
        <Select
          id="language-selector"
          value={language}
          onChange={(e) => void handleChange(e.target.value)}
          aria-label={t('language.title')}
          style={{ maxWidth: 320 }}
        >
          {SUPPORTED_LANGUAGES.map((option) => (
            <option key={option} value={option}>
              {t(`language.${option}`)}
            </option>
          ))}
        </Select>
      </FormField>

      {persistence === 'session' && showReadOnlyNote && (
        <p className="text-sm text-muted" style={{ marginTop: 'var(--versigo-space-2)' }}>
          {t('language.readOnlyNote')}
        </p>
      )}

      {saved && (
        <Alert variant="success" id="language-saved">
          {t('language.saved')}
        </Alert>
      )}
      {error && (
        <Alert variant="danger" id="language-error">
          {error}
        </Alert>
      )}
    </Card>
  );
}
