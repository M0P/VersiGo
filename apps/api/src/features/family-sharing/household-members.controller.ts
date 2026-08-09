import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { FamilySharingService } from './family-sharing.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { FamilySharingGuard } from './family-sharing.guard';
import type { AuthenticatedUser } from '../identity/auth.service';

/**
 * Lists the members of a household for the share UI (target picker when
 * creating a share).
 *
 * Access: any authenticated household member (HouseholdMembershipGuard)
 * with role USER or ADMIN (RolesGuard). READ_ONLY members cannot see the
 * complete member list; they only see shares in which they are involved.
 * FamilySharingGuard locks the list while family sharing is disabled
 * (BugFix-05).
 */
@Controller('households/:householdId/members')
@UseGuards(HouseholdMembershipGuard, FamilySharingGuard)
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
