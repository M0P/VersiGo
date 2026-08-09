import { IsIn } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../language.constants';

/**
 * AP-21: a user's language preference.
 * Only exactly 'en' or 'de' are accepted; everything else is rejected
 * with 400 validation and is never stored.
 */
export class SetLanguageDto {
  @IsIn(SUPPORTED_LANGUAGES, {
    message: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  language!: string;
}

export interface LanguagePreferenceDto {
  language: string;
  /** 'persistent' = stored in the user account (USER/ADMIN), 'session' = only for the session (READ_ONLY). */
  persistence: 'persistent' | 'session';
}
