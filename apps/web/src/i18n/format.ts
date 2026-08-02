import type { Language } from './core';

/**
 * AP-21: Sprachabhaengige Formatierungshilfen (Zahlen, Waehrungen, Datum).
 *
 * Stellt sicher, dass Zahlen, Waehrungen und Datumsangaben der aktiven
 * UI-Sprache folgen (Acceptance: "Zahlen, Waehrungen und Datum folgen der
 * aktiven Sprache"), unabhaengig von der Browser-Locale.
 */

/** BCP-47-Locale der aktiven UI-Sprache (Konvention im Projekt: de-DE/en-GB). */
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
  // Ungueltige Eingaben (RangeError im Intl-Call) abfangen: leeren String
  // zurueckgeben statt zu crashen; Rohwert als Fallback fuer Zeichenketten.
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeOf(language)).format(date);
}
