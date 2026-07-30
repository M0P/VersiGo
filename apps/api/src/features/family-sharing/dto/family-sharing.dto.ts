import { IsString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ObjectShareScopeType, ObjectSharePermission } from '@prisma/client';

export class CreateShareDto {
  @IsUUID()
  targetUserId!: string;

  @IsEnum(ObjectShareScopeType)
  scopeType!: ObjectShareScopeType;

  @IsOptional()
  @IsString()
  scopeRef?: string;

  @IsEnum(ObjectSharePermission)
  permission!: ObjectSharePermission;
}

export class UpdateShareDto {
  @IsEnum(ObjectSharePermission)
  permission!: ObjectSharePermission;
}


