import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedUser } from './auth.service';

// Global guard: checks the user's instance-wide role (GlobalRole) against
// the @Roles(...) metadata. The roles are hierarchical:
// ADMIN (3) > USER (2) > READ_ONLY (1). A user is allowed if their role
// reaches at least the lowest required role. Therefore
// "ADMIN may do everything USER may do" also applies to routes that are
// only decorated with @Roles(GlobalRole.USER).
@Injectable()
export class RolesGuard implements CanActivate {
  private static readonly ROLE_RANK: Record<GlobalRole, number> = {
    [GlobalRole.READ_ONLY]: 1,
    [GlobalRole.USER]: 2,
    [GlobalRole.ADMIN]: 3,
  };

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<GlobalRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const minimumRank = Math.min(
      ...requiredRoles.map((role) => RolesGuard.ROLE_RANK[role] ?? 0),
    );

    if ((RolesGuard.ROLE_RANK[user.role] ?? 0) < minimumRank) {
      throw new ForbiddenException('Role is not sufficient for this action');
    }

    return true;
  }
}
