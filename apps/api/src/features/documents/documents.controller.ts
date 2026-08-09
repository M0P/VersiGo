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
import { GlobalRole } from '@prisma/client';
import { Response } from 'express';
import * as fs from 'fs';
import { DocumentsService, MAX_FILE_SIZE } from './documents.service';
import type { UploadedFile as UploadedFileType } from './documents.types';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import { UploadDocumentDto, UpdateDocumentMetadataDto, CreatePaperlessLinkDto } from './dto/documents.dto';
import type { AuthenticatedUser } from '../identity/auth.service';

@Controller('households/:householdId/policies/:policyId/documents')
@UseGuards(HouseholdMembershipGuard)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly service: DocumentsService) {}

  @Post()
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async upload(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
        ],
      }),
    )
    file: UploadedFileType,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.service.upload(householdId, user.id, policyId, file, dto);
  }

  @Post('paperless')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async linkPaperless(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaperlessLinkDto,
  ) {
    // BugFix-07 (Q3): binds a Paperless document as a PolicyDocument
    // (storageType PAPERLESS_LINK), deduplicated per (policyId, storageRef).
    return this.service.linkPaperlessDocument(
      householdId,
      user.id,
      policyId,
      dto.paperlessDocumentId,
    );
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

  @Get(':docId')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async findOne(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(householdId, user, policyId, docId);
  }

  private async streamFile(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    docId: string,
    disposition: 'inline' | 'attachment',
    res: Response,
  ) {
    try {
      const { document, filePath } = await this.service.getDocumentAndPath(householdId, user, policyId, docId);

      const safeName = this.service.sanitizeFilename(document.fileName);
      const stat = await fs.promises.stat(filePath);

      const headers: Record<string, string> = {
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Content-Length': stat.size.toString(),
      };
      if (disposition === 'inline') {
        headers['Content-Security-Policy'] = "default-src 'none'";
      }
      res.set(headers);

      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        this.logger.error(`${disposition} stream error for doc ${docId}: ${err.message}`);
        stream.destroy();
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`${disposition} failed for doc ${docId}: ${(err as Error).message}`);
      throw err;
    }
  }

  @Get(':docId/download')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async download(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    return this.streamFile(householdId, user, policyId, docId, 'attachment', res);
  }

  @Get(':docId/preview')
  @Roles(GlobalRole.READ_ONLY, GlobalRole.USER, GlobalRole.ADMIN)
  async preview(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    return this.streamFile(householdId, user, policyId, docId, 'inline', res);
  }

  @Patch(':docId')
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
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
  @Roles(GlobalRole.USER, GlobalRole.ADMIN)
  async remove(
    @Param('householdId') householdId: string,
    @Param('policyId') policyId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(householdId, user.id, policyId, docId);
  }
}
