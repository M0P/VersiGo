import { describe, it, expect } from 'vitest';
import { createTranslator } from '../i18n/core';
import { localizeAuthError } from '../i18n/auth-errors';
import { formatCurrency, formatDate, formatNumber } from '../i18n/format';

const tEn = createTranslator('en');
const tDe = createTranslator('de');

describe('localizeAuthError', () => {
  it('maps login errors by HTTP status to localized catalog keys', () => {
    expect(localizeAuthError(tEn, 429, 'login')).toBe(tEn('auth.rateLimited'));
    expect(localizeAuthError(tEn, 501, 'login')).toBe(tEn('auth.loginDisabled'));
    expect(localizeAuthError(tEn, 400, 'login')).toBe(tEn('auth.credentialsRequired'));
    expect(localizeAuthError(tEn, 401, 'login')).toBe(tEn('auth.invalidCredentials'));
    expect(localizeAuthError(tEn, 500, 'login')).toBe(tEn('auth.sessionError'));
  });

  it('maps register errors by HTTP status to localized catalog keys', () => {
    expect(localizeAuthError(tEn, 429, 'register')).toBe(tEn('auth.rateLimited'));
    expect(localizeAuthError(tEn, 501, 'register')).toBe(tEn('auth.registrationDisabled'));
    expect(localizeAuthError(tEn, 400, 'register')).toBe(tEn('auth.validationError'));
    expect(localizeAuthError(tEn, 409, 'register')).toBe(tEn('auth.usernameTaken'));
  });

  it('falls back to the generic error for unknown statuses', () => {
    expect(localizeAuthError(tEn, 418, 'login')).toBe(tEn('auth.loginErrorDefault'));
    expect(localizeAuthError(tEn, 418, 'register')).toBe(tEn('auth.registrationFailedDefault'));
  });

  it('never returns raw German API messages and is language-dependent', () => {
    expect(localizeAuthError(tEn, 401, 'login')).toBe('Sign-in data is invalid.');
    expect(localizeAuthError(tDe, 401, 'login')).toBe('Anmeldedaten sind ungültig.');
    expect(localizeAuthError(tDe, 401, 'login')).not.toBe(
      localizeAuthError(tEn, 401, 'login'),
    );
  });

  it('maps the disabled-registration status (501) distinctly from a name conflict (409)', () => {
    expect(localizeAuthError(tEn, 501, 'register')).not.toBe(
      localizeAuthError(tEn, 409, 'register'),
    );
  });
});

describe('formatCurrency', () => {
  it('formats with the English (en-GB) locale', () => {
    expect(formatCurrency(1234.5, 'en')).toBe('€1,234.50');
  });

  it('formats with the German (de-DE) locale (Komma als Dezimaltrenner)', () => {
    // ICU-Varianten koennen vor dem Eurozeichen ein geschuetztes Leerzeichen
    // (U+00A0) ausgeben – normalisieren, damit der Test laufzeitstabil ist.
    const de = formatCurrency(1234.5, 'de').replace(/\u00a0/g, ' ');
    expect(de).toBe('1.234,50 €');
  });
});

describe('formatNumber', () => {
  it('uses locale-appropriate grouping and decimal separators', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
  });
});

describe('formatDate', () => {
  it('formats with the English (en-GB) locale (Tag/Monat/Jahr)', () => {
    expect(formatDate('2026-01-02', 'en')).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it('formats with the German (de-DE) locale (Tag.Monat.Jahr)', () => {
    // Kein exakter String: je nach ICU-Version wird nicht auf zwei Stellen
    // aufgefuellt ('2.1.2026' vs. '02.01.2026') – das Formatmuster ist der
    // stabile Kern der Assertion.
    expect(formatDate('2026-01-02', 'de')).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
  });

  it('returns an empty string for missing values', () => {
    expect(formatDate(null, 'en')).toBe('');
    expect(formatDate(undefined, 'de')).toBe('');
    expect(formatDate('', 'en')).toBe('');
  });

  it('does not crash on invalid input and returns the raw value', () => {
    expect(formatDate('not-a-date', 'en')).toBe('not-a-date');
  });
});
