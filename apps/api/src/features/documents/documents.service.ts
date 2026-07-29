import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@insura/foundation';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { UploadDocumentDto, UpdateDocumentMetadataDto } from './dto/documents.dto';
import { UploadedFile } from './documents.types';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly storagePath: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
  ) {
    this.storagePath = config.get('DOCUMENTS_STORAGE_PATH');
  }

  private assertValidId(id: string, label: string): void {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException(`${label} ist keine gueltige UUID`);
    }
  }

  private resolveSafePath(...segments: string[]): string {
    const resolved = path.resolve(this.storagePath, ...segments);
    const root = path.resolve(this.storagePath);
    if (!resolved.startsWith(root)) {
      throw new ForbiddenException('Ungueltiger Pfad');
    }
    return resolved;
  }

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }
  }

  private async assertPolicyAccess(householdId: string, userId: string, policyId: string): Promise<void> {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }
  }

  private validateFile(file: UploadedFile): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Dateityp ${file.mimetype} ist nicht erlaubt`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('Datei überschreitet das maximale Limit von 20 MB');
    }
  }

  private computeChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private async ensureStoragePath(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (err) {
      this.logger.warn(`Storage path creation failed: ${(err as Error).message}`);
    }
  }

  private async storeFile(policyId: string, documentId: string, buffer: Buffer): Promise<string> {
    const dir = this.resolveSafePath(policyId, documentId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, documentId);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async getFilePath(policyId: string, documentId: string): Promise<string> {
    this.assertValidId(policyId, 'policyId');
    this.assertValidId(documentId, 'documentId');
    return this.resolveSafePath(policyId, documentId, documentId);
  }

  async upload(
    householdId: string,
    userId: string,
    policyId: string,
    file: UploadedFile,
    dto: UploadDocumentDto,
  ) {
    await this.assertPolicyAccess(householdId, userId, policyId);
    this.validateFile(file);
    this.assertValidId(policyId, 'policyId');

    const checksum = this.computeChecksum(file.buffer);

    await this.ensureStoragePath();

    const document = await this.db.$transaction(async (tx) => {
      const existing = await tx.policyDocument.findFirst({
        where: { policyId, checksum, archivedAt: null },
      });

      if (existing) {
        throw new BadRequestException('Ein Dokument mit derselben Prüfsumme existiert bereits');
      }

      return tx.policyDocument.create({
        data: {
          policyId,
          storageType: 'INTERNAL',
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          checksum,
          category: dto.category,
          documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
          documentVersion: 1,
          createdByUserId: userId,
        },
      });
    });

    let storageRef: string;
    try {
      storageRef = await this.storeFile(policyId, document.id, file.buffer);
    } catch (err) {
      await this.db.policyDocument.delete({ where: { id: document.id } }).catch(() => {});
      throw err;
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.policyDocument.update({
        where: { id: document.id },
        data: { storageRef },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyDocument',
          entityId: document.id,
          action: 'CREATE',
          diffJson: {
            policyId,
            fileName: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            checksum,
            category: dto.category ?? null,
            documentDate: dto.documentDate ?? null,
          },
        },
      });

      return updated;
    });
  }

  async findAll(householdId: string, userId: string, policyId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(householdId: string, userId: string, policyId: string, docId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const document = await this.db.policyDocument.findFirst({
      where: { id: docId, policyId, archivedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Dokument nicht gefunden');
    }

    return document;
  }

  async updateMetadata(
    householdId: string,
    userId: string,
    policyId: string,
    docId: string,
    dto: UpdateDocumentMetadataDto,
  ) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyDocument.findFirst({
        where: { id: docId, policyId, archivedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Dokument nicht gefunden');
      }

      const document = await tx.policyDocument.update({
        where: { id: docId },
        data: {
          fileName: dto.fileName,
          category: dto.category,
          documentDate: dto.documentDate !== undefined
            ? (dto.documentDate ? new Date(dto.documentDate) : null)
            : undefined,
          storageType: dto.storageType,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyDocument',
          entityId: docId,
          action: 'UPDATE',
          diffJson: { ...dto },
        },
      });

      return document;
    });
  }

  async remove(householdId: string, userId: string, policyId: string, docId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyDocument.findFirst({
        where: { id: docId, policyId, archivedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Dokument nicht gefunden');
      }

      await tx.policyDocument.update({
        where: { id: docId },
        data: { archivedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyDocument',
          entityId: docId,
          action: 'ARCHIVE',
          diffJson: { archivedAt: new Date().toISOString() },
        },
      });

      return { success: true };
    });
  }
}
