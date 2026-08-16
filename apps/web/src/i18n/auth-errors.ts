import type { MessagePath, Translator } from './core';
import type { Messages } from './locales/en';

/**
 * BugFix-18: maps the `error` query parameter that the API appends to the
 * redirect after a failed OIDC callback (e.g. `authentication-failed`) to a
 * localized catalog key of the `auth` section. Unknown values return null
 * (no alert is rendered) so an unexpected server value never crashes or
 * shows a raw key.
 */
export function oidcCallbackErrorKey(
  value: string | null,
): MessagePath<Messages> | null {
  switch (value) {
    case 'authentication-failed':
      return 'auth.oidcErrorAuthenticationFailed';
    case 'missing-code-verifier':
      return 'auth.oidcErrorMissingCodeVerifier';
    case 'invalid-callback':
      return 'auth.oidcErrorInvalidCallback';
    case 'missing-state':
      return 'auth.oidcErrorMissingState';
    case 'oidc-not-configured':
      return 'auth.oidcErrorNotConfigured';
    case 'not-authenticated':
      return 'auth.oidcErrorNotAuthenticated';
    case 'session':
      return 'auth.oidcErrorSession';
    default:
      return null;
  }
}

/**
 * AP-21: localized error texts for the auth flows (login/registration).
 *
 * The API currently delivers its error messages only in German and in
 * free-text form (no machine code). So that the UI can respond
 * independently of the API's language, errors are mapped here VIA THE HTTP
 * STATUS to localized catalog keys – the raw `message` response
 * of the API is no longer displayed in the UI.
 *
 * Status semantics of the auth endpoints (contract with apps/api):
 * - 429 = rate limit (login and registration)
 * - 501 = function not enabled (login/registration disabled)
 * - 400 = validation error (login: credentials missing; registration:
 *   DTO validation)
 * - 401 = invalid credentials (login)
 * - 409 = username already taken (registration only)
 * - 500 = session error (login)
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
