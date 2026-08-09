/**
 * AP-21: i18n core – type-safe translation logic.
 *
 * - The English catalog (en.ts) is the source of truth for the key tree; the
 *   German catalog (de.ts) is forced onto the same tree via TypeScript
 *   (type-level parity; runtime parity additionally tests the concrete values).
 * - `t()` is a simple pure function (no React needed) and can therefore be
 *   used in unit tests and non-UI modules.
 * - Interpolation: `{placeholder}` in the text is replaced by the parameter.
 */

import { en, type Messages } from './locales/en';
import { de } from './locales/de';

export type { Messages } from './locales/en';

/** Productively supported languages (binding: en is the global default). */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Name of the cookie that holds the (persistent) UI language. */
export const LANGUAGE_COOKIE = 'versigo:locale';

export function isSupportedLanguage(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'de';
}

export function normalizeLanguage(value: string | null | undefined): Language {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Computes the path types of a nested catalog, e.g. `'nav.dashboard'`.
 * Used for the type-safe `t()` signature: unknown keys are already a
 * compile-time error.
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
 * Creates a translation function for the given language.
 * Fallback chain: selected language -> English -> raw key.
 * This guarantees that even a missing translation never produces empty
 * text or a crash.
 */
/**
 * Translation function.
 *
 * Static keys (literals) are checked against the catalog
 * (compile error on typos). Dynamic keys that only arise at runtime
 * (e.g. `policies.statuses.${status}` with a server-provided enum value)
 * are possible via the string fallback – the fallback to the raw key
 * prevents empty output.
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
