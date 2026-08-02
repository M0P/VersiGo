import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  isSupportedLanguage,
  normalizeLanguage,
  createTranslator,
} from '../i18n/core';
import { en } from '../i18n/locales/en';
import { de } from '../i18n/locales/de';

/** Flaettet einen verschachtelten Katalog zu "pfad.zum.key" -> "Wert". */
function flattenKeys(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenKeys(value as Record<string, unknown>, path));
    } else if (typeof value === 'string') {
      result[path] = value;
    }
  }
  return result;
}

describe('i18n core', () => {
  it('defines exactly the two supported languages with English as default', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'de']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('uses the documented language cookie name', () => {
    expect(LANGUAGE_COOKIE).toBe('versigo:locale');
  });

  it('validates supported languages', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(true);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  it('normalizes invalid values to the English default', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('fr-FR')).toBe('en');
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
  });
});

describe('createTranslator', () => {
  const tEn = createTranslator('en');
  const tDe = createTranslator('de');

  it('returns English values for English', () => {
    expect(tEn('nav.dashboard')).toBe('Dashboard');
    expect(tEn('common.loading')).toBe('Loading...');
  });

  it('returns German values for German', () => {
    expect(tDe('nav.dashboard')).toBe('Dashboard');
    expect(tDe('common.loading')).toBe('Lade...');
  });

  it('does not crash on unknown keys but returns the raw path', () => {
    expect(tEn('does.not.exist')).toBe('does.not.exist');
    expect(tDe('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates named placeholders', () => {
    expect(tEn('costs.since', { date: '01.01.2026' })).toBe('since 01.01.2026');
    expect(tDe('admin.users.count', { count: 3 })).toBe('3 Benutzer');
  });

  it('keeps unknown placeholders untouched', () => {
    expect(tEn('ai.model', { model: 'gpt-4' })).toBe('Model: gpt-4');
  });
});

describe('catalog parity (en vs de)', () => {
  const enKeys = flattenKeys(en);
  const deKeys = flattenKeys(de);

  it('has exactly the same key tree in both languages', () => {
    expect(Object.keys(deKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it('has no empty values in either catalog', () => {
    const emptyEn = Object.entries(enKeys).filter(([, v]) => v.trim() === '');
    const emptyDe = Object.entries(deKeys).filter(([, v]) => v.trim() === '');
    expect(emptyEn).toEqual([]);
    expect(emptyDe).toEqual([]);
  });

  it('German values differ from English values (actually translated)', () => {
    // Repraesentative Schluessel, die in der deutschen Fassung zwingend
    // uebersetzt sein muessen (keine identischen Fachbegriffe).
    const mustDiffer: Array<keyof typeof enKeys> = [
      'common.loading',
      'policies.title',
      'policies.newPolicy',
      'dashboard.welcome',
      'auth.login',
      'auth.register',
      'settings.title',
      'settings.saveProfile',
      'appearance.title',
      'language.title',
      'ai.title',
      'admin.users.title',
      'admin.settings.title',
      'costs.title',
      'forbidden.title',
    ];
    for (const key of mustDiffer) {
      expect(enKeys[key], `en[${key}]`).toBeTruthy();
      expect(deKeys[key], `de[${key}]`).toBeTruthy();
      expect(enKeys[key]).not.toBe(deKeys[key]);
    }
  });
});
