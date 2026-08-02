'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  LANGUAGE_COOKIE,
  normalizeLanguage,
  type Language,
  type MessageParams,
  type MessagePath,
  type Translator,
} from './core';
import type { Messages } from './locales/en';
import {
  fetchLanguagePreference,
  saveLanguagePreference,
  type LanguagePersistence,
} from './language-client';

type I18nContextValue = {
  /** Aktive Sprache der Oberflaeche (verbindlicher Default: en). */
  language: Language;
  /** Dauerhaftigkeit der aktuellen Aufloesung (Konto vs. Sitzung). */
  persistence: LanguagePersistence | null;
  /** true, bis die serverseitige Sprachaufloesung abgeschlossen ist. */
  loading: boolean;
  /** Aendert die Sprache (persistiert je nach Rolle Konto oder Sitzung). */
  setLanguage: (language: Language) => Promise<void>;
  /** Uebersetzungsfunktion fuer die aktive Sprache. */
  t: Translator;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/** Schreibt bzw. entfernt den Sprach-Cookie. */
export function writeLanguageCookie(language: Language | null): void {
  if (typeof document === 'undefined') return;
  if (language) {
    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(language)}; path=/; max-age=31536000; samesite=lax`;
  } else {
    document.cookie = `${LANGUAGE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

export function I18nProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  /** Vom Root-Layout (Server) aufgeloeste Sprache aus dem Cookie. */
  initialLanguage?: Language;
}): ReactElement {
  // Deterministische Initialisierung: Der Server uebergibt die Sprache aus
  // dem Cookie, sodass Server-HTML und erste Client-Hydration uebereinstimmen.
  // Ohne Cookie (READ_ONLY, Gast) gilt der globale Default Englisch.
  const [language, setLanguageState] = useState<Language>(normalizeLanguage(initialLanguage));
  const [persistence, setPersistence] = useState<LanguagePersistence | null>(null);
  const [loading, setLoading] = useState(true);

  const applyLanguage = useCallback((next: Language, nextPersistence?: LanguagePersistence | null) => {
    setLanguageState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
    }
    if (nextPersistence === 'persistent') {
      writeLanguageCookie(next);
    } else if (nextPersistence === 'session') {
      // READ_ONLY: Sprache lebt ausschliesslich in der Sitzung – der Cookie
      // darf NICHT persistiert werden (session-only).
      writeLanguageCookie(null);
    }
  }, []);

  // Serverseitige Sprachaufloesung (Konto-Einstellung bzw. READ_ONLY-
  // Sitzungssprache) beim ersten Rendern abrufen und mit dem Cookie
  // abgleichen.
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const preference = await fetchLanguagePreference();
      if (cancelled) return;
      if (preference && isSupportedLanguage(preference.language)) {
        applyLanguage(preference.language as Language, preference.persistence);
      }
      setLoading(false);
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [applyLanguage]);

  const setLanguage = useCallback(
    async (next: Language): Promise<void> => {
      const previous = language;
      // Optimistische Aktualisierung; die Cookie-Entscheidung folgt der
      // Serverantwort (persistent vs. session).
      setLanguageState(next);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = next;
      }

      const preference = await saveLanguagePreference(next);
      if (preference) {
        setPersistence(preference.persistence);
        if (preference.persistence === 'persistent') {
          writeLanguageCookie(next);
        } else {
          writeLanguageCookie(null);
        }
      } else {
        // Fehlgeschlagen: auf den vorherigen Stand zurueckfallen, damit die
        // UI nicht in einem Zustand bleibt, den der Server nicht kennt.
        setLanguageState(previous);
        if (typeof document !== 'undefined') {
          document.documentElement.lang = previous;
        }
      }
    },
    [language],
  );

  const t = useMemo(() => createTranslator(language), [language]);

  const value = useMemo<I18nContextValue>(
    () => ({ language, persistence, loading, setLanguage, t }),
    [language, persistence, loading, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Hook fuer Uebersetzungen. Muss innerhalb des I18nProvider verwendet
 * werden (in der Root-Providers-Kette enthalten).
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

// Re-Export der Typen fuer bequeme Verwendung an den Aufrufstellen.
export type { Language, MessageParams, MessagePath, Messages };
