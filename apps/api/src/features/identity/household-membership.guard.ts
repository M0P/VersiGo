import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.service';

// Enforces tenant separation: every request with a :householdId param is
// checked against the actual membership at the database level, not only
// gegen den (potenziell veralteten) Session-Claim.
@Injectable()
export class HouseholdMembershipGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    const householdId: string | undefined =
      request.params?.householdId ?? request.body?.householdId;

    if (!householdId) return true;
    if (!user) throw new ForbiddenException('Not authenticated');

    const membership = await this.authService.getMembership(user.id, householdId);
    if (!membership) {
      throw new ForbiddenException('Isolation: no access to a foreign household');
    }

    request.householdMembership = membership;
    return true;
  }
}
