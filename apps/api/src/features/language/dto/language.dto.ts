import { IsIn } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../language.constants';

/**
 * AP-21: Sprachwunsch eines Nutzers.
 * Nur exakt 'en' oder 'de' werden akzeptiert; alles andere lehnt die
 * Validierung mit 400 ab und wird niemals gespeichert.
 */
export class SetLanguageDto {
  @IsIn(SUPPORTED_LANGUAGES, {
    message: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  language!: string;
}

export interface LanguagePreferenceDto {
  language: string;
  /** 'persistent' = dauerhaft im Benutzerkonto (USER/ADMIN), 'session' = nur fuer die Sitzung (READ_ONLY). */
  persistence: 'persistent' | 'session';
}
