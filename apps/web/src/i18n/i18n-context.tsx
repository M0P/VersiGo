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
  /** Active UI language (binding default: en). */
  language: Language;
  /** Persistence of the current resolution (account vs. session). */
  persistence: LanguagePersistence | null;
  /** true until the server-side language resolution has finished. */
  loading: boolean;
  /** Changes the language (persisted per role as account or session). */
  setLanguage: (language: Language) => Promise<void>;
  /** Translation function for the active language. */
  t: Translator;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/** Writes or removes the language cookie. */
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
  /** Language resolved by the root layout (server) from the cookie. */
  initialLanguage?: Language;
}): ReactElement {
  // Deterministic initialization: the server passes the language from
  // the cookie so that server HTML and the first client hydration agree.
  // Without a cookie (READ_ONLY, guest) the global default English applies.
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
      // READ_ONLY: the language lives exclusively in the session – the cookie
      // must NOT be persisted (session-only).
      writeLanguageCookie(null);
    }
  }, []);

  // Fetch the server-side language resolution (account setting or READ_ONLY
  // session language) on first render and reconcile it with the cookie.
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
      // Optimistic update; the cookie decision follows the server response
      // (persistent vs. session).
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
        // Failed: fall back to the previous state so that the
        // UI does not remain in a state the server does not know about.
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
 * Hook for translations. Must be used within the I18nProvider
 * (included in the root provider chain).
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

// Re-export of the types for convenient use at the call sites.
export type { Language, MessageParams, MessagePath, Messages };
