/**
 * AP-21: i18n-Kern – typsichere Uebersetzungslogik.
 *
 * - Die englische Katalogdatei (en.ts) ist die Quelle der Wahrheit fuer den
 *   Schluesselbaum; die deutsche Katalogdatei (de.ts) wird per TypeScript
 *   auf denselben Baum gezwungen (Parity auf Typebene, Laufzeit-Parity
 *   testet zusaetzlich die konkreten Werte).
 * - `t()` ist eine einfache, reine Funktion (kein React nötig) und
 *   dadurch in Unit-Tests und Nicht-UI-Modulen nutzbar.
 * - Interpolation: `{platzhalter}` im Text wird durch den Parameter ersetzt.
 */

import { en, type Messages } from './locales/en';
import { de } from './locales/de';

export type { Messages } from './locales/en';

/** Produktiv unterstuetzte Sprachen (verbindlich: en ist globaler Default). */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Name des Cookies, in dem die (persistente) Sprache der Oberflaeche liegt. */
export const LANGUAGE_COOKIE = 'versigo:locale';

export function isSupportedLanguage(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'de';
}

export function normalizeLanguage(value: string | null | undefined): Language {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Berechnet die Pfadtypen eines verschachtelten Katalogs, z. B.
 * `'nav.dashboard'`. Wird fuer die typsichere `t()`-Signatur genutzt:
 * unbekannte Schluessel sind bereits zur Compile-Zeit ein Fehler.
 */
export type MessagePath<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object ? `${K}.${MessagePath<T[K]>}` : K;
    }[keyof T & string]
  : never;

export type MessageParams = Record<string, string | number>;

const MESSAGES: Record<Language, Messages> = { en, de };

function lookup(messages: Messages, path: string): string | undefined {
  let current: unknown = messages;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Erzeugt eine Uebersetzungsfunktion fuer die angegebene Sprache.
 * Fallback-Kette: gewaehlte Sprache -> Englisch -> roher Schluessel.
 * Damit ist sichergestellt, dass auch bei einer fehlenden Uebersetzung
 * niemals ein leerer Text oder ein Crash entsteht.
 */
/**
 * Uebersetzungsfunktion.
 *
 * Statische Schluessel (Literale) werden gegen den Katalog geprueft
 * (Compile-Fehler bei Tippfehlern). Dynamische Schluessel, die erst zur
 * Laufzeit entstehen (z. B. `policies.statuses.${status}` mit einem vom
 * Server gelieferten Enum-Wert), sind ueber den String-Fallback moeglich –
 * der Ruckfall auf den rohen Schluessel verhindert dabei leere Ausgaben.
 */
export type Translator = (
  path: MessagePath<Messages> | (string & {}),
  params?: MessageParams,
) => string;

export function createTranslator(language: Language): Translator {
  const source = MESSAGES[language] ?? MESSAGES[DEFAULT_LANGUAGE];

  return function t(path: MessagePath<Messages> | (string & {}), params?: MessageParams): string {
    const localized = lookup(source, path);
    if (localized !== undefined) return interpolate(localized, params);

    const fallback = lookup(MESSAGES[DEFAULT_LANGUAGE], path);
    if (fallback !== undefined) return interpolate(fallback, params);

    return path;
  };
}
