import { IsString, Length, Matches } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_REGEX,
} from './auth.service';

export class LocalLoginDto {
  @IsString()
  @Length(3, 32)
  username!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RegisterLocalAccountDto {
  @IsString()
  @Matches(USERNAME_REGEX, {
    message:
      'Username: 3-32 characters, lowercase letters, digits and . _ - (start with a letter or digit)',
  })
  username!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: `password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long`,
  })
  password!: string;
}

/**
 * BugFix-16: password change of the signed-in user (POST /auth/change-password).
 * The current password is verified against the stored hash before the new one
 * is set. Passwords are never stored, logged or audited.
 */
export class ChangePasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH, {
    message: `currentPassword must be between 1 and ${PASSWORD_MAX_LENGTH} characters long`,
  })
  currentPassword!: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: `newPassword must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long`,
  })
  newPassword!: string;
}
