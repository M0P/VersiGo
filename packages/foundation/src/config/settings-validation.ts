import { getSettingDefinition, type SettingDefinition } from './settings-catalog';

/**
 * Typstrikte Validierung eines Rohwerts gegen einen Katalog-Schluessel
 * (AP-17). Wird von SettingsResolverService (Laufzeit-Aufloesung) UND
 * der Admin-API (Persistenz) verwendet, damit beide genau dieselben
 * Regeln anwenden: Booleans akzeptieren ausschliesslich "true"/"false"
 * (kein implizites Boolean(String)-Verhalten), Zahlen sind Ganzzahlen
 * mit optionalem Min/Max-Rahmen, Strings werden ggf. gegen
 * allowedValues geprueft.
 */

export interface ValidatedValue {
  ok: true;
  value: string | number | boolean;
  /** Kanonische String-Form fuer die Datenbank-Persistenz. */
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

  // Leere Werte werden generell abgewiesen (auch fuer Strings): Die
  // Resolver/Preload behandeln leere Werte ohnehin als "nicht gesetzt" –
  // eine UI-Persistenz eines leeren Werts wuerde nur eine tote DB-Zeile
  // erzeugen, die als `uiValuePresent: false` erscheint.
  if (input === '') {
    return invalid('Wert darf nicht leer sein');
  }

  switch (definition.type) {
    case 'boolean': {
      const normalized = input.toLowerCase();
      if (normalized === 'true') return { ok: true, value: true, canonical: 'true' };
      if (normalized === 'false') return { ok: true, value: false, canonical: 'false' };
      return invalid('erwartet wird "true" oder "false"');
    }
    case 'number': {
      if (!/^-?\d+$/.test(input)) {
        return invalid('erwartet wird eine ganze Zahl');
      }
      const number = Number(input);
      if (definition.min !== undefined && number < definition.min) {
        return invalid(`mindestens ${definition.min}`);
      }
      if (definition.max !== undefined && number > definition.max) {
        return invalid(`hoechstens ${definition.max}`);
      }
      return { ok: true, value: number, canonical: String(number) };
    }
    case 'string': {
      if (definition.allowedValues && !definition.allowedValues.includes(input)) {
        return invalid(`erlaubt sind: ${definition.allowedValues.join(', ')}`);
      }
      return { ok: true, value: input, canonical: input };
    }
    default:
      return invalid('unbekannter Wertetyp');
  }
}

/**
 * Validierung direkt per Katalog-Schluessel. Wirft fuer unbekannte
 * (nicht katalogisierte) Schluessel – die Allowlist gilt ausnahmslos.
 */
export function validateSettingValueByKey(key: string, raw: string): ValidationResult {
  const definition = getSettingDefinition(key);
  if (!definition) {
    throw new Error(`Unbekannter Settings-Schluessel '${key}' – nicht im Katalog (Allowlist).`);
  }
  return validateSettingValue(definition, raw);
}
