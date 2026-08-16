/**
 * AP-21: public i18n API of the web app.
 *
 * Usage in client components:
 *   import { useI18n } from '../../i18n';
 *   const { t } = useI18n();
 *   <h1>{t('policies.title')}</h1>
 *
 * The key path is type-safe: unknown keys are a
 * compile error. The catalogs live in ./locales (en = source of
 * truth, de = structurally enforced).
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
export { localizeAuthError, oidcCallbackErrorKey } from './auth-errors';
export { formatCurrency, formatDate, formatNumber } from './format';
