import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { HouseholdRole } from '@prisma/client';
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
   * Startet einen asynchronen AI-Extraktions-Job.
   */
  @Post('extract')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async startExtraction(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartExtractionDto,
  ) {
    return this.aiAssistService.startExtraction(householdId, user.id, dto.policyId);
  }

  /**
   * Fuehrt eine Extraktion sofort durch (synchron, fuer Debug).
   */
  @Post('extract-now')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN)
  async extractNow(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartExtractionDto,
  ) {
    const result = await this.aiAssistService.extractNow(householdId, user.id, dto.policyId);
    if (result === null) {
      throw new NotFoundException('AI-Extraktion fehlgeschlagen oder AI deaktiviert');
    }
    return result;
  }

  /**
   * Listet alle Extraktions-Jobs einer Police auf.
   */
  @Get(':policyId/jobs')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async listJobs(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiAssistService.listJobs(householdId, user.id, policyId);
  }

  /**
   * Ruft den Status eines bestimmten Extraktions-Jobs ab.
   */
  @Get(':policyId/jobs/:jobId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async getJobStatus(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiAssistService.getJobStatus(householdId, user.id, policyId, jobId);
  }

  /**
   * Erstellt eine Zusammenfassung des Versicherungsschutzes.
   */
  @Post(':policyId/summarize')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async summarize(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.aiAssistService.summarize(householdId, user.id, policyId);
    if (result === null) {
      throw new NotFoundException('AI-Zusammenfassung fehlgeschlagen oder AI deaktiviert');
    }
    return result;
  }

  /**
   * Ruft die letzte Zusammenfassung einer Police ab.
   */
  @Get(':policyId/summary')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async getLatestSummary(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiAssistService.getLatestSummary(householdId, user.id, policyId);
  }

  /**
   * Markiert ein Dokument als von AI-Verarbeitung ausgeschlossen.
   */
  @Post(':policyId/documents/exclusion')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
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
   * Prueft die Verbindung zum AI-Provider.
   */
  @Get('health')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN)
  async healthCheck(
    @Param('householdId') _householdId: string,
  ) {
    return this.aiAssistService.healthCheck();
  }
}
