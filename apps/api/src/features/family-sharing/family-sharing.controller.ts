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
import { FamilySharingService } from './family-sharing.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { CreateShareDto, UpdateShareDto } from './dto/family-sharing.dto';
import { FamilySharingGuard } from './family-sharing.guard';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/shares')
@UseGuards(HouseholdMembershipGuard, FamilySharingGuard)
export class FamilySharingController {
  constructor(private readonly service: FamilySharingService) {}

  @Post()
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async create(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShareDto,
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

  @Get('incoming')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findIncoming(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findIncoming(householdId, user.id);
  }

  @Get('outgoing')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findOutgoing(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOutgoing(householdId, user.id);
  }

  @Get(':shareId')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user, shareId);
  }

  @Patch(':shareId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async update(
    @Param('householdId') householdId: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateShareDto,
  ) {
    return this.service.update(householdId, user.id, shareId, dto);
  }

  @Delete(':shareId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async remove(
    @Param('householdId') householdId: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(householdId, user, shareId);
  }
}
