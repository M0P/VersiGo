import { describe, it, expect } from 'vitest';
import { createTranslator } from '../i18n/core';
import { localizeAuthError, oidcCallbackErrorKey } from '../i18n/auth-errors';
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

describe('oidcCallbackErrorKey (BugFix-18)', () => {
  it('maps every error value the API redirects with to a localized auth key', () => {
    expect(oidcCallbackErrorKey('authentication-failed')).toBe('auth.oidcErrorAuthenticationFailed');
    expect(oidcCallbackErrorKey('missing-code-verifier')).toBe('auth.oidcErrorMissingCodeVerifier');
    expect(oidcCallbackErrorKey('invalid-callback')).toBe('auth.oidcErrorInvalidCallback');
    expect(oidcCallbackErrorKey('missing-state')).toBe('auth.oidcErrorMissingState');
    expect(oidcCallbackErrorKey('oidc-not-configured')).toBe('auth.oidcErrorNotConfigured');
    expect(oidcCallbackErrorKey('not-authenticated')).toBe('auth.oidcErrorNotAuthenticated');
    expect(oidcCallbackErrorKey('session')).toBe('auth.oidcErrorSession');
  });

  it('returns null for unknown values (no alert, no raw key in the UI)', () => {
    expect(oidcCallbackErrorKey(null)).toBeNull();
    expect(oidcCallbackErrorKey('')).toBeNull();
    expect(oidcCallbackErrorKey('some-unknown-error')).toBeNull();
  });

  it('produces existing, non-empty, localized messages in both languages', () => {
    const keys = [
      'auth.oidcErrorAuthenticationFailed',
      'auth.oidcErrorMissingCodeVerifier',
      'auth.oidcErrorInvalidCallback',
      'auth.oidcErrorMissingState',
      'auth.oidcErrorNotConfigured',
      'auth.oidcErrorNotAuthenticated',
      'auth.oidcErrorSession',
    ] as const;
    for (const key of keys) {
      expect(tEn(key).trim()).not.toBe('');
      expect(tDe(key).trim()).not.toBe('');
      expect(tEn(key)).not.toBe(tDe(key));
    }
  });
});

describe('formatCurrency', () => {
  it('formats with the English (en-GB) locale', () => {
    expect(formatCurrency(1234.5, 'en')).toBe('€1,234.50');
  });

  it('formats with the German (de-DE) locale (comma as decimal separator)', () => {
    // ICU variants may output a protected space (U+00A0) before the euro sign -
    // normalize so the test is stable across ICU versions.
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
  it('formats with the English (en-GB) locale (day/month/year)', () => {
    expect(formatDate('2026-01-02', 'en')).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it('formats with the German (de-DE) locale (day.month.year)', () => {
    // No exact string: depending on the ICU version the value is not padded
    // to two digits ('2.1.2026' vs. '02.01.2026') - the format pattern is the
    // stable core of the assertion.
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
