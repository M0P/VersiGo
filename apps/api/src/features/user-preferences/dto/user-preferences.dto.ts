import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * DTO for setting a user preference.
 */
export class SetUserPreferenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  value!: string;
}

/**
 * DTO for returning a user preference.
 */
export class UserPreferenceResponseDto {
  key!: string;
  value!: string;
  createdAt!: string;
  updatedAt!: string;
}
