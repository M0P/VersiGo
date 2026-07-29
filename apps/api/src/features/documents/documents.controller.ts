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
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HouseholdRole } from '@prisma/client';
import { Response } from 'express';
import * as fs from 'fs';
import { DocumentsService } from './documents.service';
import type { UploadedFile } from './documents.types';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { UploadDocumentDto, UpdateDocumentMetadataDto } from './dto/documents.dto';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/policies/:policyId/documents')
@UseGuards(HouseholdMembershipGuard)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly service: DocumentsService) {}

  private sanitizeFilename(name: string): string {
    return name.replace(/["\r\n]/g, '').replace(/[<>:/\\|?*]/g, '_');
  }

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
    file: UploadedFile,
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
    try {
      const document = await this.service.findOne(householdId, user.id, policyId, docId);
      const filePath = await this.service.getFilePath(policyId, docId);

      const safeName = this.sanitizeFilename(document.fileName);
      const stat = await fs.promises.stat(filePath);

      res.set({
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Content-Length': stat.size.toString(),
      });

      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        this.logger.error(`download stream error for doc ${docId}: ${err.message}`);
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`download failed for doc ${docId}: ${(err as Error).message}`);
      throw err;
    }
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
    try {
      const document = await this.service.findOne(householdId, user.id, policyId, docId);
      const filePath = await this.service.getFilePath(policyId, docId);

      const safeName = this.sanitizeFilename(document.fileName);
      const stat = await fs.promises.stat(filePath);

      res.set({
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Content-Length': stat.size.toString(),
      });

      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        this.logger.error(`preview stream error for doc ${docId}: ${err.message}`);
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`preview failed for doc ${docId}: ${(err as Error).message}`);
      throw err;
    }
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
