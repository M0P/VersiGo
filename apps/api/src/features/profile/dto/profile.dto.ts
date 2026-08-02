import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Von der Profilseite aenderbare Locales. Bewusste Allowlist statt
 * freiem String – die UI nutzt ausschliesslich diese Werte.
 *
 * AP-21: Nur noch die produktiv unterstuetzten Sprachcodes 'en' und 'de'
 * (die uebrigen Legacy-Locales sind entfernt). Die Web-UI zeigt die
 * Sprachwahl kuenftig ueber den zentralen /user/language-Endpunkt;
 * das Profil-Feld bleibt aus API-Kompatibilitaetsgruenden bestehen.
 */
export const SUPPORTED_PROFILE_LOCALES = ['en', 'de'] as const;

/**
 * DTO fuer Profilaenderungen. NUR persoenliche Profilfelder; Rollen,
 * Freigaben, Zugangsdaten und Systemwerte sind hier niemals editierbar.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsIn(SUPPORTED_PROFILE_LOCALES, { message: 'locale ist nicht erlaubt' })
  locale?: string;
}

/** Oeffentliche Profilansicht (ohne sensitive Werte). */
export class ProfileResponseDto {
  id!: string;
  username!: string;
  displayName!: string;
  locale!: string;
  role!: string;
  createdAt!: string;
}
