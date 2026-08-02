/**
 * AP-21: Sprachcode-Konstanten und Normalisierung.
 *
 * `en` und `de` sind die einzigen produktiv unterstuetzten Sprachen.
 * Nicht unterstuetzte Werte (z. B. Legacy-Werte wie "de-DE", "fr-FR" oder
 * beliebige Eingaben) fallen sicher auf Englisch zurueck und werden niemals
 * unvalidiert gespeichert.
 */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function isSupportedLanguage(value: string | null | undefined): value is LanguageCode {
  return value === 'en' || value === 'de';
}

/**
 * Normalisiert einen Sprachwert auf einen unterstuetzten Sprachcode.
 * Alles, was nicht exakt 'en' oder 'de' ist, faellt sicher auf Englisch
 * zurueck (verbindlicher Default).
 */
export function normalizeLanguage(value: string | null | undefined): LanguageCode {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Leitet die erste unterstuetzte Sprache aus einem Accept-Language-Header
 * ab. Es wird die q-Wert-Prioritaet des Browsers beachtet; fehlt ein
 * unterstuetzter Eintrag, wird null geliefert (Aufrufer entscheidet ueber
 * den Fallback).
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
