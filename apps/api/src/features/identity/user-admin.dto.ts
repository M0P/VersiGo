import { IsEnum, IsString, Length, IsOptional, IsInt, Min, Max, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';
import { GlobalRole, UserStatus } from '@prisma/client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.service';

export class ListUsersQueryDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}

export class SetUserRoleDto {
  @IsEnum(GlobalRole)
  role!: GlobalRole;
}

export class BindOidcIdentityDto {
  @IsUrl({ require_tld: false }, { message: 'oidcIssuer must be a valid URL' })
  @Length(1, 512)
  oidcIssuer!: string;

  @IsString()
  @Length(1, 256)
  oidcSubject!: string;
}

/**
 * BugFix-16: admin password reset (POST /admin/users/:id/reset-password).
 * The new password is set directly (no current password needed). Passwords
 * are never stored, logged or audited.
 */
export class ResetUserPasswordDto {
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, {
    message: `newPassword must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long`,
  })
  newPassword!: string;
}
