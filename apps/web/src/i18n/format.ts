import type { Language } from './core';

/**
 * AP-21: language-dependent formatting helpers (numbers, currencies, dates).
 *
 * Ensures that numbers, currencies and dates follow the active UI language
 * (acceptance: "numbers, currencies and dates follow the active language"),
 * independent of the browser locale.
 */

/** BCP-47 locale of the active UI language (project convention: de-DE/en-GB). */
export function localeOf(language: Language): string {
  return language === 'de' ? 'de-DE' : 'en-GB';
}

export function formatNumber(
  value: number,
  language: Language,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeOf(language), options).format(value);
}

export function formatCurrency(value: number, language: Language): string {
  return new Intl.NumberFormat(localeOf(language), {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

export function formatDate(
  value: string | number | Date | null | undefined,
  language: Language,
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  // Catch invalid inputs (RangeError in the Intl call): return an empty
  // string instead of crashing; the raw value is the fallback for strings.
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeOf(language)).format(date);
}
