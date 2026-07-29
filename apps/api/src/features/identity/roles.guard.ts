import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HouseholdRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedUser } from './auth.service';

// Rollenrang fuer hierarchische Pruefung (OWNER deckt ADMIN-Anforderungen ab).
const ROLE_RANK: Record<HouseholdRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<HouseholdRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    const householdId: string | undefined =
      request.params?.householdId ?? request.body?.householdId;

    if (!user || !householdId) {
      throw new ForbiddenException('Household-Kontext fehlt');
    }

    const membership = user.memberships.find((m) => m.householdId === householdId);
    if (!membership) {
      throw new ForbiddenException('Kein Zugriff auf dieses Household');
    }

    const minRequiredRank = Math.min(
      ...requiredRoles.map((r) => ROLE_RANK[r]),
    );
    if (ROLE_RANK[membership.role] < minRequiredRank) {
      throw new ForbiddenException('Rolle reicht fuer diese Aktion nicht aus');
    }

    request.householdMembership = membership;
    return true;
  }
}
