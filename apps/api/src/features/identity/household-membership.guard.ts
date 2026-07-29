import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.service';

// Erzwingt Mandantentrennung: jeder Request mit :householdId-Param wird
// datenbankseitig gegen die tatsaechliche Mitgliedschaft geprueft, nicht nur
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
    if (!user) throw new ForbiddenException('Nicht authentifiziert');

    const membership = await this.authService.getMembership(user.id, householdId);
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }

    request.householdMembership = membership;
    return true;
  }
}
