import type { Translator } from './core';

/**
 * AP-21: Lokalisierte Fehlertexte fuer die Auth-Flows (Login/Registrierung).
 *
 * Die API liefert ihre Fehlermeldungen bislang nur auf Deutsch und in
 * Freitextform (kein Maschinen-Code). Damit die UI unabhaengig von der
 * Sprache der API antwortet, werden Fehler hier UEBER DEN HTTP-STATUS auf
 * lokalisierte Katalog-Schluessel abgebildet – die rohe `message`-Antwort
 * der API wird in der UI nicht mehr angezeigt.
 *
 * Status-Semantik der Auth-Endpunkte (Vertrag mit apps/api):
 * - 429 = Rate-Limit (Login und Registrierung)
 * - 501 = Funktion nicht aktiviert (Login/Registrierung deaktiviert)
 * - 400 = Validierungsfehler (Login: Zugangsdaten fehlen; Registrierung:
 *   DTO-Validierung)
 * - 401 = Zugangsdaten ungueltig (Login)
 * - 409 = Benutzername bereits vergeben (nur Registrierung)
 * - 500 = Session-Fehler (Login)
 */
export function localizeAuthError(
  t: Translator,
  status: number,
  context: 'login' | 'register',
): string {
  switch (status) {
    case 429:
      return t('auth.rateLimited');
    case 501:
      return t(context === 'login' ? 'auth.loginDisabled' : 'auth.registrationDisabled');
    default:
      break;
  }

  if (context === 'login') {
    switch (status) {
      case 400:
        return t('auth.credentialsRequired');
      case 401:
        return t('auth.invalidCredentials');
      case 500:
        return t('auth.sessionError');
      default:
        return t('auth.loginErrorDefault');
    }
  }

  switch (status) {
    case 400:
      return t('auth.validationError');
    case 409:
      return t('auth.usernameTaken');
    default:
      return t('auth.registrationFailedDefault');
  }
}
