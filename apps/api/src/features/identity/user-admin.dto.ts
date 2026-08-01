import { IsEnum, IsString, Length, IsOptional, IsInt, Min, Max, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';
import { GlobalRole, UserStatus } from '@prisma/client';

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
  @IsUrl({ require_tld: false }, { message: 'oidcIssuer muss eine gueltige URL sein' })
  @Length(1, 512)
  oidcIssuer!: string;

  @IsString()
  @Length(1, 256)
  oidcSubject!: string;
}
