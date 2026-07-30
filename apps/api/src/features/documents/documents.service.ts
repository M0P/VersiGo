import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@insura/foundation';
import type { Prisma } from '@prisma/client';
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

const MAGIC_BYTES: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/tiff': [Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
  'application/msword': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ],
  'application/vnd.ms-excel': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ],
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly storagePath: string;
  private storagePathEnsured = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
  ) {
    this.storagePath = path.resolve(config.get('DOCUMENTS_STORAGE_PATH'));
  }

  private assertValidId(id: string, label: string): void {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException(`${label} ist keine gueltige UUID`);
    }
  }

  private resolveSafePath(...segments: string[]): string {
    const root = path.resolve(this.storagePath) + path.sep;
    const resolved = path.resolve(this.storagePath, ...segments);
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

  private validateFileMagicBytes(mimetype: string, buffer: Buffer): void {
    const signatures = MAGIC_BYTES[mimetype];
    if (!signatures) return;

    const valid = signatures.some((sig) => sig.equals(buffer.subarray(0, sig.length)));
    if (!valid) {
      throw new BadRequestException('Datei-Inhalt stimmt nicht mit dem angegebenen Dateityp überein');
    }
  }

  private validateFile(file: UploadedFile): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Dateityp ${file.mimetype} ist nicht erlaubt`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`Datei überschreitet das maximale Limit von ${MAX_FILE_SIZE / 1024 / 1024} MB`);
    }

    if (file.originalname.length > 255) {
      throw new BadRequestException('Dateiname ist zu lang (max. 255 Zeichen)');
    }

    this.validateFileMagicBytes(file.mimetype, file.buffer);
  }

  sanitizeFilename(name: string): string {
    const cleaned = name.replace(/["\r\n]/g, '').replace(/[<>:/\\|?*]/g, '_');
    return cleaned || 'document';
  }

  private computeChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private async ensureStoragePath(): Promise<void> {
    if (this.storagePathEnsured) return;
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      this.storagePathEnsured = true;
    } catch (err) {
      this.logger.error(`Storage path creation failed: ${(err as Error).message}`);
      throw err;
    }
  }

  private async storeFile(policyId: string, documentId: string, buffer: Buffer): Promise<string> {
    this.assertValidId(policyId, 'policyId');
    this.assertValidId(documentId, 'documentId');
    const dir = this.resolveSafePath(policyId, documentId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, documentId);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async getFilePath(householdId: string, userId: string, policyId: string, documentId: string): Promise<string> {
    await this.assertPolicyAccess(householdId, userId, policyId);
    this.assertValidId(policyId, 'policyId');
    this.assertValidId(documentId, 'documentId');
    return this.resolveSafePath(policyId, documentId, documentId);
  }

  async getDocumentAndPath(
    householdId: string,
    userId: string,
    policyId: string,
    docId: string,
  ): Promise<{ document: { id: string; fileName: string; mimeType: string | null }; filePath: string }> {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const document = await this.db.policyDocument.findFirst({
      where: { id: docId, policyId, archivedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Dokument nicht gefunden');
    }

    const filePath = this.resolveSafePath(policyId, docId, docId);
    return { document, filePath };
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
          fileName: this.sanitizeFilename(file.originalname),
          mimeType: file.mimetype,
          fileSize: file.size,
          checksum,
          category: dto.category,
          documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
          createdByUserId: userId,
        },
      });
    }).catch((err) => {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`upload document (phase 1) failed: ${err.message}`, err.stack);
      throw err;
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
            fileName: this.sanitizeFilename(file.originalname),
            mimeType: file.mimetype,
            fileSize: file.size,
            checksum,
            category: dto.category ?? null,
            documentDate: dto.documentDate ?? null,
          },
        },
      });

      return updated;
    }).catch(async (err) => {
      this.logger.error(`upload document (phase 2) failed: ${err.message}`, err.stack);
      await fs.unlink(storageRef).catch(() => {});
      throw err;
    });
  }

  async findAll(householdId: string, userId: string, policyId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    return this.db.policyDocument.findMany({
      where: { policyId, archivedAt: null },
      orderBy: { uploadedAt: 'desc' },
      take: 200,
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
          fileName: dto.fileName !== undefined ? this.sanitizeFilename(dto.fileName) : undefined,
          category: dto.category,
          documentDate: dto.documentDate !== undefined
            ? (dto.documentDate ? new Date(dto.documentDate) : null)
            : undefined,
        },
      });

      const diff: Record<string, unknown> = { ...dto };
      if (dto.documentDate !== undefined) {
        diff.documentDate = dto.documentDate
          ? new Date(dto.documentDate).toISOString()
          : null;
      }

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyDocument',
          entityId: docId,
          action: 'UPDATE',
          diffJson: diff as Prisma.InputJsonValue,
        },
      });

      return document;
    }).catch((err) => {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`update document ${docId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  async remove(householdId: string, userId: string, policyId: string, docId: string) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const filePath = this.resolveSafePath(policyId, docId, docId);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        this.logger.warn(`remove: disk file already gone for doc ${docId} at ${filePath}`);
      } else {
        this.logger.error(`remove disk file ${filePath} failed: ${nodeErr.message}`);
        throw err;
      }
    }

    const archivedAt = new Date();

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyDocument.findFirst({
        where: { id: docId, policyId, archivedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Dokument nicht gefunden');
      }

      await tx.policyDocument.update({
        where: { id: docId },
        data: { archivedAt },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'PolicyDocument',
          entityId: docId,
          action: 'ARCHIVE',
          diffJson: { archivedAt: archivedAt.toISOString() },
        },
      });

      return { success: true };
    }).catch((err) => {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`remove document ${docId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }
}
