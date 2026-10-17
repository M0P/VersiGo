import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { CurrentUser } from '../identity/current-user.decorator';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { PaperlessTagService } from './paperless-tag.service';
import {
  CreatePaperlessTagDto,
  RetryPaperlessTaggingDto,
  SearchPaperlessTagsQueryDto,
  SetPolicyPaperlessTagDto,
} from './dto/paperless-tag.dto';

/**
 * AP-22: tag-based document assignment (Paperless-ngx).
 *
 * All routes are household-scoped and guarded by HouseholdMembershipGuard;
 * the tag catalogue itself belongs to the single configured Paperless
 * connection, but is only reachable from within an authorised household.
 * Read-only roles may inspect the configuration, only USER/ADMIN may change
 * it – mirroring the existing document permission convention.
 */
@Controller()
@UseGuards(HouseholdMembershipGuard)
export class PaperlessTagController {
  constructor(private readonly service: PaperlessTagService) {}

  @Get('households/:householdId/paperless-tags')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async searchTags(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchPaperlessTagsQueryDto,
  ) {
    return this.service.searchTags(householdId, user, query.search ?? '', query.page ?? 1);
  }

  @Post('households/:householdId/paperless-tags')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async createTag(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaperlessTagDto,
  ) {
    return this.service.createTag(householdId, user, dto.name);
  }

  @Get('households/:householdId/policies/:policyId/paperless-tag')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getConfig(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getConfig(householdId, user, policyId);
  }

  @Put('households/:householdId/policies/:policyId/paperless-tag')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async setTag(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPolicyPaperlessTagDto,
  ) {
    return this.service.setTag(householdId, user.id, policyId, dto.tagId, dto.tagName);
  }

  @Delete('households/:householdId/policies/:policyId/paperless-tag')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async removeTag(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeTag(householdId, user.id, policyId);
  }

  @Get('households/:householdId/policies/:policyId/paperless-tag/status')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getStatus(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getStatus(householdId, user, policyId);
  }

  @Post('households/:householdId/policies/:policyId/paperless-tag/sync')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async requestSync(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.requestSync(householdId, user.id, policyId);
  }

  @Post('households/:householdId/policies/:policyId/paperless-tag/retry')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async retryTagging(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RetryPaperlessTaggingDto,
  ) {
    return this.service.retryTagging(householdId, user.id, policyId, dto.documentId);
  }
}
