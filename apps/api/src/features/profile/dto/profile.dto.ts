import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Locales changeable from the profile page. Deliberate allowlist instead
 * of a free string – the UI uses exclusively these values.
 *
 * AP-21: only the productively supported language codes 'en' and 'de'
 * remain (the other legacy locales were removed). The web UI shows the
 * language choice in the future via the central /user/language endpoint;
 * the profile field remains for API-compatibility reasons.
 */
export const SUPPORTED_PROFILE_LOCALES = ['en', 'de'] as const;

/**
 * DTO for profile changes. ONLY personal profile fields; roles, shares,
 * credentials and system values are never editable here.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsIn(SUPPORTED_PROFILE_LOCALES, { message: 'locale is not allowed' })
  locale?: string;
}

/** Public profile view (without sensitive values). */
export class ProfileResponseDto {
  id!: string;
  username!: string;
  displayName!: string;
  locale!: string;
  role!: string;
  createdAt!: string;
}
