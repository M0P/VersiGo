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

/**
 * BugFix-22: renders one per-basis amount (gross or net). A missing basis
 * is shown as a dash placeholder – never as 0 and never with a value
 * borrowed from the other basis.
 */
export function formatBasisAmount(value: number | null, language: Language): string {
  return value == null ? '—' : formatCurrency(value, language);
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

/**
 * BugFix-22: uniform date format TT.MM.JJJJ (zero-padded) for the costs
 * views – deliberately locale-independent so that all cost tables use the
 * same date format regardless of the UI language.
 *
 * Full ISO timestamps (…Z) are decoded with UTC parts because the backend
 * stores calendar dates as UTC midnight – otherwise every timestamp would
 * show the previous day in time zones west of UTC. Date-only values are
 * decoded as local calendar dates.
 */
export function formatDateDmy(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const isUtcTimestamp =
    typeof value === 'string' && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value);
  const day = String(isUtcTimestamp ? date.getUTCDate() : date.getDate()).padStart(2, '0');
  const month = String(
    (isUtcTimestamp ? date.getUTCMonth() : date.getMonth()) + 1,
  ).padStart(2, '0');
  const year = isUtcTimestamp ? date.getUTCFullYear() : date.getFullYear();
  return `${day}.${month}.${year}`;
}
