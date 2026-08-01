import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { PolicyRegistryService } from './policy-registry.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  CreateCoveredPersonDto,
  UpdateCoveredPersonDto,
  CreatePortalAccountLinkDto,
  UpdatePortalAccountLinkDto,
} from './dto/policy-registry.dto';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/policies')
@UseGuards(HouseholdMembershipGuard)
export class PolicyRegistryController {
  constructor(private readonly service: PolicyRegistryService) {}

  @Post()
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async create(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePolicyDto,
  ) {
    return this.service.create(householdId, user.id, dto);
  }

  @Get()
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findAll(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(householdId, user);
  }

  @Get(':policyId')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user, policyId);
  }

  @Patch(':policyId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async update(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePolicyDto,
  ) {
    return this.service.update(householdId, user.id, policyId, dto);
  }

  @Delete(':policyId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async remove(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(householdId, user.id, policyId);
  }

  @Delete(':policyId/hard')
  @Roles(GlobalRole.ADMIN)
  async hardDelete(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.hardDelete(householdId, user.id, policyId);
  }

  // Covered Persons

  @Post(':policyId/covered-persons')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async addCoveredPerson(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCoveredPersonDto,
  ) {
    return this.service.addCoveredPerson(householdId, user.id, policyId, dto);
  }

  @Patch(':policyId/covered-persons/:personId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async updateCoveredPerson(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('personId') personId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCoveredPersonDto,
  ) {
    return this.service.updateCoveredPerson(householdId, user.id, policyId, personId, dto);
  }

  @Delete(':policyId/covered-persons/:personId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async removeCoveredPerson(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('personId') personId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeCoveredPerson(householdId, user.id, policyId, personId);
  }

  // Portal Account Links

  @Post(':policyId/portal-links')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async createPortalLink(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePortalAccountLinkDto,
  ) {
    return this.service.createPortalLink(householdId, user.id, policyId, dto);
  }

  @Patch(':policyId/portal-links/:linkId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async updatePortalLink(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePortalAccountLinkDto,
  ) {
    return this.service.updatePortalLink(householdId, user.id, policyId, linkId, dto);
  }

  @Delete(':policyId/portal-links/:linkId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async removePortalLink(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removePortalLink(householdId, user.id, policyId, linkId);
  }
}
