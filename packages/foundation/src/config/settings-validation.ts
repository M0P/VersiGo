import { getSettingDefinition, type SettingDefinition } from './settings-catalog';

/**
 * Strictly typed validation of a raw value against a catalog key (AP-17).
 * Used by the SettingsResolverService (runtime resolution) AND the
 * admin API (persistence) so both apply exactly the same rules:
 * booleans only accept "true"/"false" (no implicit Boolean(String)
 * behavior), numbers are integers with an optional min/max range,
 * strings are checked against allowedValues when applicable.
 */

export interface ValidatedValue {
  ok: true;
  value: string | number | boolean;
  /** Canonical string form for database persistence. */
  canonical: string;
}

export interface ValidationError {
  ok: false;
  error: string;
}

export type ValidationResult = ValidatedValue | ValidationError;

function invalid(error: string): ValidationError {
  return { ok: false, error };
}

export function validateSettingValue(
  definition: SettingDefinition,
  raw: string,
): ValidationResult {
  const input = raw.trim();

  // Empty values are generally rejected (also for strings): the
  // resolver/preload treat empty values as "unset" anyway — persisting
  // an empty value via the UI would only create a dead DB row that
  // appears as `uiValuePresent: false`.
  if (input === '') {
    return invalid('Value must not be empty');
  }

  switch (definition.type) {
    case 'boolean': {
      const normalized = input.toLowerCase();
      if (normalized === 'true') return { ok: true, value: true, canonical: 'true' };
      if (normalized === 'false') return { ok: true, value: false, canonical: 'false' };
      return invalid('expected "true" or "false"');
    }
    case 'number': {
      if (!/^-?\d+$/.test(input)) {
        return invalid('expected an integer');
      }
      const number = Number(input);
      if (definition.min !== undefined && number < definition.min) {
        return invalid(`at least ${definition.min}`);
      }
      if (definition.max !== undefined && number > definition.max) {
        return invalid(`at most ${definition.max}`);
      }
      return { ok: true, value: number, canonical: String(number) };
    }
    case 'string': {
      if (definition.allowedValues && !definition.allowedValues.includes(input)) {
        return invalid(`allowed values: ${definition.allowedValues.join(', ')}`);
      }
      return { ok: true, value: input, canonical: input };
    }
    default:
      return invalid('unknown value type');
  }
}

/**
 * Validation directly by catalog key. Throws for unknown
 * (non-catalogued) keys — the allowlist applies without exception.
 */
export function validateSettingValueByKey(key: string, raw: string): ValidationResult {
  const definition = getSettingDefinition(key);
  if (!definition) {
    throw new Error(`Unknown settings key '${key}' – not in the catalog (allowlist).`);
  }
  return validateSettingValue(definition, raw);
}
