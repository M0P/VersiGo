import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { FamilySharingService } from './family-sharing.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';

/**
 * Listet die Mitglieder eines Households fuer die Freigabe-UI
 * (Ziel-Auswahl beim Anlegen einer Freigabe).
 *
 * Zugriff: jedes authentifizierte Household-Mitglied
 * (HouseholdMembershipGuard) mit Rolle USER oder ADMIN (RolesGuard).
 * READ_ONLY-Mitglieder koennen die vollstaendige Mitgliederliste nicht
 * sehen; sie sehen ausschliesslich Freigaben, an denen sie beteiligt sind.
 */
@Controller('households/:householdId/members')
@UseGuards(HouseholdMembershipGuard)
export class HouseholdMembersController {
  constructor(private readonly familySharingService: FamilySharingService) {}

  @Get()
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async listMembers(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.familySharingService.listMembers(householdId, user.id);
  }
}
