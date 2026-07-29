import { SetMetadata } from '@nestjs/common';
import { HouseholdRole } from '@prisma/client';

export const ROLES_KEY = 'requiredRoles';

// @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN) auf Controller-Methode
export const Roles = (...roles: HouseholdRole[]) => SetMetadata(ROLES_KEY, roles);
