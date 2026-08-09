/**
 * AP-21: language code constants and normalization.
 *
 * `en` and `de` are the only productively supported languages.
 * Unsupported values (e.g. legacy values like "de-DE", "fr-FR" or
 * arbitrary input) safely fall back to English and are never stored
 * unvalidated.
 */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function isSupportedLanguage(value: string | null | undefined): value is LanguageCode {
  return value === 'en' || value === 'de';
}

/**
 * Normalizes a language value to a supported language code.
 * Everything that is not exactly 'en' or 'de' safely falls back to
 * English (binding default).
 */
export function normalizeLanguage(value: string | null | undefined): LanguageCode {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Derives the first supported language from an Accept-Language header
 * priority. The browser's q-value priority is respected; if no supported
 * entry exists, null is returned (the caller decides the fallback).
 */
export function languageFromAcceptLanguage(
  header: string | null | undefined,
): LanguageCode | null {
  if (!header) return null;

  type Candidate = { lang: LanguageCode; q: number; order: number };

  const candidates: Candidate[] = [];
  header
    .split(',')
    .map((segment, order) => {
      const [rawLang, rawQ = ''] = segment.trim().split(';');
      const q = Number.parseFloat(rawQ.replace(/^q=/i, ''));
      return {
        raw: rawLang.trim().toLowerCase(),
        q: Number.isFinite(q) ? q : 1,
        order,
      };
    })
    .forEach(({ raw, q, order }) => {
      const lang = raw.split('-')[0];
      if (lang === 'de') candidates.push({ lang: 'de', q, order });
      if (lang === 'en') candidates.push({ lang: 'en', q, order });
    });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.q - a.q || a.order - b.order);
  return candidates[0].lang;
}
