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

// Global-Guard: prueft die instance-weite Rolle (GlobalRole) des Users gegen
// die @Roles(...)-Metadaten. Die Rollen sind hierarchisch:
// ADMIN (3) > USER (2) > READ_ONLY (1). Ein User ist zugelassen, wenn seine
// Rolle mindestens die niedrigste geforderte Rolle erreicht. Dadurch gilt
// "ADMIN darf alles, was USER darf" auch fuer Routen, die nur mit
// @Roles(GlobalRole.USER) ausgezeichnet sind.
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
      throw new ForbiddenException('Nicht authentifiziert');
    }

    const minimumRank = Math.min(
      ...requiredRoles.map((role) => RolesGuard.ROLE_RANK[role] ?? 0),
    );

    if ((RolesGuard.ROLE_RANK[user.role] ?? 0) < minimumRank) {
      throw new ForbiddenException('Rolle reicht fuer diese Aktion nicht aus');
    }

    return true;
  }
}
