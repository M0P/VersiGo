import { SetMetadata } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';

export const ROLES_KEY = 'requiredRoles';

// @Roles(GlobalRole.ADMIN) on a controller method/class
export const Roles = (...roles: GlobalRole[]) => SetMetadata(ROLES_KEY, roles);
