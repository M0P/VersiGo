import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HouseholdRole } from '@prisma/client';
import { CostTrackingService } from './cost-tracking.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { CreateCostEntryDto, UpdateCostEntryDto } from './dto/cost-tracking.dto';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/policies/:policyId/costs')
@UseGuards(HouseholdMembershipGuard)
export class CostTrackingController {
  constructor(private readonly service: CostTrackingService) {}

  @Post()
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async create(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCostEntryDto,
  ) {
    return this.service.create(householdId, user.id, policyId, dto);
  }

  @Get()
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findAll(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(householdId, user.id, policyId);
  }

  @Get('annual')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async getAnnualCost(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getAnnualCost(householdId, user.id, policyId);
  }

  @Get('compare')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async getYearComparison(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
  ) {
    return this.service.getYearComparison(householdId, user.id, policyId, Number(year));
  }

  @Get(':entryId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user.id, policyId, entryId);
  }

  @Patch(':entryId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async update(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCostEntryDto,
  ) {
    return this.service.update(householdId, user.id, policyId, entryId, dto);
  }

  @Delete(':entryId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN)
  async remove(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(householdId, user.id, policyId, entryId);
  }
}

@Controller('households/:householdId/costs')
@UseGuards(HouseholdMembershipGuard)
export class CostTrackingHouseholdController {
  constructor(private readonly service: CostTrackingService) {}

  @Get('summary')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async getSummary(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getHouseholdSummary(householdId, user.id);
  }
}
