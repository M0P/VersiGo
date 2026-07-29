import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HouseholdRole } from '@prisma/client';
import { Response } from 'express';
import * as fs from 'fs/promises';
import { DocumentsService } from './documents.service';
import type { UploadedFile as InsuraUploadedFile } from './documents.types';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { UploadDocumentDto, UpdateDocumentMetadataDto } from './dto/documents.dto';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/policies/:policyId/documents')
@UseGuards(HouseholdMembershipGuard)
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Post()
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 }),
        ],
      }),
    )
    file: InsuraUploadedFile,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.service.upload(householdId, user.id, policyId, file, dto);
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

  @Get(':docId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user.id, policyId, docId);
  }

  @Get(':docId/download')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async download(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const document = await this.service.findOne(householdId, user.id, policyId, docId);
    const filePath = await this.service.getFilePath(policyId, docId);

    const buffer = await fs.readFile(filePath);

    res.set({
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${document.fileName}"`,
      'Content-Length': buffer.length.toString(),
    });

    res.send(buffer);
  }

  @Get(':docId/preview')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER, HouseholdRole.VIEWER)
  async preview(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const document = await this.service.findOne(householdId, user.id, policyId, docId);
    const filePath = await this.service.getFilePath(policyId, docId);

    const buffer = await fs.readFile(filePath);

    res.set({
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${document.fileName}"`,
      'Content-Length': buffer.length.toString(),
    });

    res.send(buffer);
  }

  @Patch(':docId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN, HouseholdRole.MEMBER)
  async updateMetadata(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDocumentMetadataDto,
  ) {
    return this.service.updateMetadata(householdId, user.id, policyId, docId, dto);
  }

  @Delete(':docId')
  @Roles(HouseholdRole.OWNER, HouseholdRole.ADMIN)
  async remove(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(householdId, user.id, policyId, docId);
  }
}
