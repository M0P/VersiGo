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
import { HouseholdRole } from '@prisma/client';
import { FamilySharingService } from './family-sharing.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { CreateShareDto, UpdateShareDto } from './dto/family-sharing.dto';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/shares')
@UseGuards(HouseholdMembershipGuard)
export class FamilySharingController {
  constructor(private readonly service: FamilySharingService) {}

  @Post()
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async create(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShareDto,
  ) {
    return this.service.create(householdId, user.id, dto);
  }

  @Get()
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findAll(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(householdId, user.id);
  }

  @Get('incoming')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findIncoming(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findIncoming(householdId, user.id);
  }

  @Get('outgoing')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findOutgoing(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOutgoing(householdId, user.id);
  }

  @Get(':shareId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user.id, shareId);
  }

  @Patch(':shareId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async update(
    @Param('householdId') householdId: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateShareDto,
  ) {
    return this.service.update(householdId, user.id, shareId, dto);
  }

  @Delete(':shareId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async remove(
    @Param('householdId') householdId: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(householdId, user.id, shareId);
  }
}
