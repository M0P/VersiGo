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
 * Shape of the express session used by the LanguageController.
 * READ_ONLY users store their language exclusively here (session-bound,
 * no database, no history).
 */
export interface LanguageSessionData {
  language?: string;
  [key: string]: unknown;
}

@Injectable()
export class LanguageService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Determines the active language of an authenticated user.
   *
   * Priority (binding per AP-21):
   * 1. READ_ONLY: language explicitly chosen in this session, otherwise
   *    browser preference (Accept-Language), otherwise English.
   * 2. USER/ADMIN: stored account setting (users.locale), otherwise
   *    browser preference, otherwise English.
   *
   * Unsupported or invalid values always fall back safely to English.
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
   * Sets the language of an authenticated user.
   *
   * - READ_ONLY: only in the session (never in the database), no audit
   *   entry, no history.
   * - USER/ADMIN: stored persistently in users.locale.
   *
   * Invalid values are rejected (BadRequest) and never stored.
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
    // Legacy/regional values (e.g. fr-FR) from old data are not considered
    // supported; the caller then falls back to the browser preference or en.
    return isSupportedLanguage(profile?.locale) ? profile.locale : null;
  }
}
