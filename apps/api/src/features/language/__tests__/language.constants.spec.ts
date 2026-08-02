import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  languageFromAcceptLanguage,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
} from '../language.constants';

describe('language.constants', () => {
  it('unterstuetzt exakt en und de', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'de']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('isSupportedLanguage akzeptiert nur en und de', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(true);
    expect(isSupportedLanguage('de-DE')).toBe(false);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  it('normalizeLanguage faellt fuer alles ausser en/de sicher auf en zurueck', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('de-DE')).toBe('en');
    expect(normalizeLanguage('fr-FR')).toBe('en');
    expect(normalizeLanguage('it-IT')).toBe('en');
    expect(normalizeLanguage('')).toBe('en');
    expect(normalizeLanguage(null)).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(normalizeLanguage('EN')).toBe('en');
  });

  describe('languageFromAcceptLanguage', () => {
    it('liefert null bei fehlendem Header', () => {
      expect(languageFromAcceptLanguage(undefined)).toBeNull();
      expect(languageFromAcceptLanguage(null)).toBeNull();
      expect(languageFromAcceptLanguage('')).toBeNull();
    });

    it('liefert null, wenn keine unterstuetzte Sprache im Header steht', () => {
      expect(languageFromAcceptLanguage('fr-FR,fr;q=0.9,es;q=0.8')).toBeNull();
    });

    it('erkennt einfache Header', () => {
      expect(languageFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
      expect(languageFromAcceptLanguage('de-DE,de;q=0.9')).toBe('de');
    });

    it('beachtet die q-Wert-Prioritaet des Browsers', () => {
      expect(languageFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8')).toBe('de');
      expect(languageFromAcceptLanguage('en-US,en;q=0.9,de;q=0.8')).toBe('en');
      expect(languageFromAcceptLanguage('de;q=0.5,en;q=1')).toBe('en');
    });

    it('ignoriert nicht unterstuetzte Eintraege bei der Prioritaetsauswahl', () => {
      expect(languageFromAcceptLanguage('fr;q=1,de;q=0.5')).toBe('de');
      expect(languageFromAcceptLanguage('fr;q=1,de-DE;q=0.5,en;q=0.4')).toBe('de');
    });

    it('normalisiert regionale Varianten auf den Sprachcode', () => {
      expect(languageFromAcceptLanguage('de-AT,de;q=0.9')).toBe('de');
      expect(languageFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en');
    });

    it('behandelt Gross-/Kleinschreibung tolerant', () => {
      expect(languageFromAcceptLanguage('DE-de,de;q=0.9,EN;q=0.5')).toBe('de');
    });
  });
});
