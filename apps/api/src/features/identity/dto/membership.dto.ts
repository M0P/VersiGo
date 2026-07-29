import { IsEnum, IsUUID } from 'class-validator';
import { HouseholdRole } from '@prisma/client';

export class CreateMembershipDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  householdId!: string;

  @IsEnum(HouseholdRole)
  role!: HouseholdRole;
}
