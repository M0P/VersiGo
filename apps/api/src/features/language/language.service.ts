import { BadRequestException, Injectable } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { DatabaseService } from '@versigo/foundation';
import type { AuthenticatedUser } from '../identity/auth.service';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  languageFromAcceptLanguage,
  type LanguageCode,
} from './language.constants';
import type { LanguagePreferenceDto } from './dto/language.dto';

/**
 * Form der express-session, die der LanguageController nutzt.
 * READ_ONLY-Nutzer hinterlegen ihre Sprache ausschliesslich hier
 * (sitzungsbezogen, keine Datenbank, kein Verlauf).
 */
export interface LanguageSessionData {
  language?: string;
  [key: string]: unknown;
}

@Injectable()
export class LanguageService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Ermittelt die aktive Sprache eines authentifizierten Nutzers.
   *
   * Prioritaet (verbindlich laut AP-21):
   * 1. READ_ONLY:  explizit in dieser Sitzung gewaehlte Sprache,
   *    sonst Browserpräferenz (Accept-Language), sonst Englisch.
   * 2. USER/ADMIN: gespeicherte Kontoeinstellung (users.locale),
   *    sonst Browserpräferenz, sonst Englisch.
   *
   * Nicht unterstuetzte oder ungueltige Werte fallen immer sicher auf
   * Englisch zurueck.
   */
  async resolveLanguage(
    user: AuthenticatedUser,
    session: LanguageSessionData | null | undefined,
    acceptLanguage?: string,
  ): Promise<LanguagePreferenceDto> {
    if (user.role === GlobalRole.READ_ONLY) {
      const sessionLanguage = session?.language;
      if (isSupportedLanguage(sessionLanguage)) {
        return { language: sessionLanguage, persistence: 'session' };
      }
      const browserLanguage = languageFromAcceptLanguage(acceptLanguage);
      if (browserLanguage) {
        return { language: browserLanguage, persistence: 'session' };
      }
      return { language: DEFAULT_LANGUAGE, persistence: 'session' };
    }

    const storedLanguage = await this.readStoredLanguage(user.id);
    if (isSupportedLanguage(storedLanguage)) {
      return { language: storedLanguage, persistence: 'persistent' };
    }
    const browserLanguage = languageFromAcceptLanguage(acceptLanguage);
    if (browserLanguage) {
      return { language: browserLanguage, persistence: 'persistent' };
    }
    return { language: DEFAULT_LANGUAGE, persistence: 'persistent' };
  }

  /**
   * Setzt die Sprache eines authentifizierten Nutzers.
   *
   * - READ_ONLY:  nur in der Sitzung (nie in der Datenbank),
   *   kein Audit-Eintrag, kein Verlauf.
   * - USER/ADMIN: dauerhaft in users.locale gespeichert.
   *
   * Ungueltige Werte werden abgelehnt (BadRequest) und nie gespeichert.
   */
  async setLanguage(
    user: AuthenticatedUser,
    session: LanguageSessionData | null | undefined,
    language: string,
  ): Promise<LanguagePreferenceDto> {
    if (!isSupportedLanguage(language)) {
      throw new BadRequestException(
        `Unsupported language '${language}'. Supported: ${['en', 'de'].join(', ')}`,
      );
    }

    if (user.role === GlobalRole.READ_ONLY) {
      if (session) {
        session.language = language;
      }
      return { language, persistence: 'session' };
    }

    await this.db.user.update({
      where: { id: user.id },
      data: { locale: language as LanguageCode },
    });
    return { language, persistence: 'persistent' };
  }

  private async readStoredLanguage(userId: string): Promise<LanguageCode | null> {
    const profile = await this.db.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    // Legacy-/Regionalwerte (z. B. fr-FR) aus Altbeständen gelten nicht als
    // unterstützt; der Aufrufer fällt dann auf die Browserpräferenz bzw. en.
    return isSupportedLanguage(profile?.locale) ? profile.locale : null;
  }
}
