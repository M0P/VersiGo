/**
 * AP-21: Oeffentliche i18n-API der Web-App.
 *
 * Nutzung in Client-Komponenten:
 *   import { useI18n } from '../../i18n';
 *   const { t } = useI18n();
 *   <h1>{t('policies.title')}</h1>
 *
 * Der Schluesselpfad ist typsicher: unbekannte Schluessel sind ein
 * Compile-Fehler. Die Kataloge liegen in ./locales (en = Quelle der
 * Wahrheit, de = strukturgleich erzwungen).
 */
export {
  I18nProvider,
  useI18n,
  writeLanguageCookie,
} from './i18n-context';
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  createTranslator,
  isSupportedLanguage,
  normalizeLanguage,
} from './core';
export type { Language, MessageParams, MessagePath, Messages, Translator } from './core';
export { fetchLanguagePreference, saveLanguagePreference } from './language-client';
export type { LanguagePreference, LanguagePersistence } from './language-client';
export { localizeAuthError } from './auth-errors';
export { formatCurrency, formatDate, formatNumber } from './format';
