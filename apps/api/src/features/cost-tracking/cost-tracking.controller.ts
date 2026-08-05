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
import { GlobalRole } from '@prisma/client';
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
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async create(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCostEntryDto,
  ) {
    return this.service.create(householdId, user.id, policyId, dto);
  }

  @Get()
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findAll(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(householdId, user, policyId);
  }

  // BugFix-05 (Befund 3): Kostenuebersicht mit paidToDate + perFrequency.
  @Get('overview')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getOverview(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getOverview(householdId, user, policyId);
  }

  @Get('annual')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getAnnualCost(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getAnnualCost(householdId, user, policyId);
  }

  @Get('compare')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getYearComparison(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
  ) {
    return this.service.getYearComparison(householdId, user, policyId, Number(year));
  }

  @Get(':entryId')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user, policyId, entryId);
  }

  @Patch(':entryId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
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
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
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
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getSummary(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getHouseholdSummary(householdId, user);
  }
}
