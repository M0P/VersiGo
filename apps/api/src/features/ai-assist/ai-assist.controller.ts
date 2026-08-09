import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { AiAssistService } from './ai-assist.service';
import { StartExtractionDto, SetDocumentExclusionDto } from './ai-assist.dto';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/ai')
@UseGuards(HouseholdMembershipGuard)
export class AiAssistController {
  constructor(private readonly aiAssistService: AiAssistService) {}

  /**
   * Starts an asynchronous AI extraction job.
   */
  @Post('extract')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async startExtraction(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartExtractionDto,
  ) {
    return this.aiAssistService.startExtraction(householdId, user.id, dto.policyId);
  }

  /**
   * Runs an extraction immediately (synchronous, for debugging).
   */
  @Post('extract-now')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async extractNow(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartExtractionDto,
  ) {
    const result = await this.aiAssistService.extractNow(householdId, user.id, dto.policyId);
    if (result === null) {
      throw new NotFoundException('AI extraction failed or AI is disabled');
    }
    return result;
  }

  /**
   * Lists all extraction jobs of a policy.
   */
  @Get(':policyId/jobs')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async listJobs(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiAssistService.listJobs(householdId, user, policyId);
  }

  /**
   * Retrieves the status of a specific extraction job.
   */
  @Get(':policyId/jobs/:jobId')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getJobStatus(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiAssistService.getJobStatus(householdId, user, policyId, jobId);
  }

  /**
   * Creates a summary of the insurance coverage.
   */
  @Post(':policyId/summarize')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async summarize(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.aiAssistService.summarize(householdId, user.id, policyId);
    if (result === null) {
      throw new NotFoundException('AI summarization failed or AI is disabled');
    }
    return result;
  }

  /**
   * Returns the latest summary of a policy including source document information.
   */
  @Get(':policyId/summary')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async getLatestSummary(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiAssistService.getLatestSummaryWithSources(householdId, user, policyId);
  }

  /**
   * Checks whether AI is configured and enabled for this household.
   * Lightweight check without policy context for the UI.
   */
  @Get('status')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async aiStatus(
    @Param('householdId') _householdId: string,
  ) {
    return this.aiAssistService.healthCheck();
  }

  /**
   * Marks a document as excluded from AI processing.
   */
  @Post(':policyId/documents/exclusion')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async setDocumentExclusion(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetDocumentExclusionDto,
  ) {
    return this.aiAssistService.setDocumentExclusion(
      householdId,
      user.id,
      policyId,
      dto.documentId,
      dto.excluded,
    );
  }

  /**
   * Checks the connection to the AI provider.
   */
  @Get('health')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async healthCheck(
    @Param('householdId') _householdId: string,
  ) {
    return this.aiAssistService.healthCheck();
  }
}
