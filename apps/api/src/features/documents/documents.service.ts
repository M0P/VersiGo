import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { DatabaseService, AppConfigService } from '@versigo/foundation';
import type { DocumentClass, PolicyDocument, Prisma } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { UploadDocumentDto, UpdateDocumentMetadataDto, BulkClassifyDocumentsDto } from './dto/documents.dto';
import { UploadedFile } from './documents.types';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';
import {
  PAPERLESS_ADAPTER,
  IPaperlessAdapter,
  type PaperlessDocumentMetadata,
} from '../paperless-ngx/paperless-ngx.interface';
import { PaperlessTagService } from '../paperless-ngx/paperless-tag.service';
import { PAPERLESS_TAG_TAG_DOCUMENT_JOB } from '../paperless-ngx/paperless-tag.constants';

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

/**
 * AP-24 (§2.3): upper bound for one bulk classification request. Bounds the
 * write load of a single call without getting in the way of normal use (the
 * list itself is capped at 200 documents).
 */
export const MAX_BULK_CLASSIFY = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * BugFix-21 (review #2): parses a Paperless timestamp defensively.
 * `created` is external input – an unusable value must not be turned into an
 * `Invalid Date` that makes Prisma reject the write (the worker guards the
 * same field the same way, see `parsePaperlessDate` in
 * `apps/worker/src/paperless-tag.processor.ts`).
 */
function parsePaperlessDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly storagePath: string;
  private storagePathEnsured = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly authService: AuthService,
    // BugFix-07 (Q3): adapter for Paperless links. Degrades itself in a
    // controlled way (null/empty results) when Paperless is disabled.
    @Inject(PAPERLESS_ADAPTER) private readonly paperless: IPaperlessAdapter,
    // AP-22: durable tag-job outbox for manual Paperless links.
    private readonly paperlessTags: PaperlessTagService,
  ) {
    this.storagePath = path.resolve(config.get('DOCUMENTS_STORAGE_PATH'));
  }

  private assertValidId(id: string, label: string): void {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException(`${label} is not a valid UUID`);
    }
  }

  private resolveSafePath(...segments: string[]): string {
    const root = path.resolve(this.storagePath) + path.sep;
    const resolved = path.resolve(this.storagePath, ...segments);
    if (!resolved.startsWith(root)) {
      throw new ForbiddenException('Invalid path');
    }
    return resolved;
  }

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: no access to a foreign household');
    }
  }

  private async assertPolicyAccess(householdId: string, userId: string, policyId: string): Promise<void> {
    await this.assertHouseholdAccess(householdId, userId);

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
    });

    if (!policy) {
      throw new NotFoundException('Policy not found');
    }
  }

  private validateFileMagicBytes(mimetype: string, buffer: Buffer): void {
    const signatures = MAGIC_BYTES[mimetype];
    if (!signatures) return;

    const valid = signatures.some((sig) => sig.equals(buffer.subarray(0, sig.length)));
    if (!valid) {
      throw new BadRequestException('File content does not match the declared file type');
    }
  }

  private validateFile(file: UploadedFile): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`File type ${file.mimetype} is not allowed`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`File exceeds the maximum limit of ${MAX_FILE_SIZE / 1024 / 1024} MB`);
    }

    if (file.originalname.length > 255) {
      throw new BadRequestException('Filename is too long (max. 255 characters)');
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
    user: AuthenticatedUser,
    policyId: string,
    docId: string,
  ): Promise<{ document: { id: string; fileName: string; mimeType: string | null }; filePath: string }> {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const document = await this.db.policyDocument.findFirst({
      where: { id: docId, policyId, archivedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // AP-25: a PAPERLESS_LINK document has no local file. A path resolved from
    // its id can never exist, so the later stat() failed with ENOENT and the
    // preview answered with an opaque 500 ("Internal server error", Nest's
    // default for a raw error) instead of a usable error code. Refuse it
    // explicitly instead.
    if (document.storageType === 'PAPERLESS_LINK') {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_STORED_LOCALLY',
        message: 'This document is stored in Paperless-ngx and has no local file',
      });
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
        throw new BadRequestException('A document with the same checksum already exists');
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
          // AP-24 (§2): Klasse beim Upload; ohne Angabe bleibt der
          // Spalten-Default UNCLASSIFIED.
          documentClass: dto.documentClass ?? undefined,
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
            documentClass: dto.documentClass ?? 'UNCLASSIFIED',
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

  /**
   * AP-24 (§2.3): the document list can be narrowed to a single class
   * (e.g. `BILLING` for the cost sidebar). Omitting the parameter keeps the
   * previous, unfiltered behaviour.
   */
  async findAll(
    householdId: string,
    user: AuthenticatedUser,
    policyId: string,
    documentClass?: DocumentClass,
  ) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const documents = await this.db.policyDocument.findMany({
      where: {
        policyId,
        archivedAt: null,
        ...(documentClass ? { documentClass } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
      take: 200,
    });

    // BugFix-07 (Q3): include the deep link into the Paperless UI for
    // PAPERLESS_LINK documents (fault-tolerant - on a Paperless outage the
    // link stays null and the UI only shows the metadata).
    return Promise.all(
      documents.map(async (doc) => {
        if (doc.storageType !== 'PAPERLESS_LINK' || !doc.storageRef) return doc;
        const deepLink = await this.paperless.getDeepLink(Number(doc.storageRef)).catch(() => null);
        return { ...doc, deepLink };
      }),
    );
  }

  /**
   * BugFix-07 (Q3): binds a Paperless document as a PolicyDocument
   * (storageType PAPERLESS_LINK, storageRef = paperlessId). Deduplicates per
   * (policyId, storageRef): re-linking the same document idempotently
   * returns the existing entry. The document must exist in Paperless and
   * the adapter must be configured.
   *
   * AP-22: the link is additionally recorded as a `MANUAL` origin. When a
   * policy tag is configured, a durable TAG_DOCUMENT outbox row is created
   * in the SAME transaction as the link (no job can be lost between the DB
   * change and the queue insertion) and the external tag assignment is
   * marked PENDING until the worker confirms it.
   *
   * Race-safe (BugFix-07, code review): check-then-insert runs inside ONE
   * transaction. Concurrently linked requests that both pass the check are
   * caught by the partial unique index (policyId, storageRef) WHERE
   * archivedAt IS NULL AND storageType = 'PAPERLESS_LINK'
   * (migration ..._bugfix07_paperless_link_dedupe): the losing writer gets
   * P2002 and the existing entry is returned idempotently.
   */
  async linkPaperlessDocument(
    householdId: string,
    userId: string,
    policyId: string,
    paperlessDocumentId: number,
  ) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    const metadata = await this.paperless.getDocumentMetadata(paperlessDocumentId);
    if (!metadata) {
      throw new NotFoundException(
        'Document not found in Paperless or Paperless is not configured',
      );
    }

    let linked: { document: PolicyDocument; tagJobId: string | null } | null = null;
    try {
      linked = await this.db.$transaction(async (tx) => {
        const existing = await tx.policyDocument.findFirst({
          where: {
            policyId,
            storageType: 'PAPERLESS_LINK',
            storageRef: String(paperlessDocumentId),
            archivedAt: null,
          },
        });
        if (existing) return this.applyManualLinkOrigin(tx, policyId, existing, metadata);

        const document = await tx.policyDocument.create({
          data: {
            policyId,
            storageType: 'PAPERLESS_LINK',
            fileName: metadata.title?.trim() || `Paperless document ${paperlessDocumentId}`,
            // BugFix-21: the MIME type is stored so the document list can
            // show a type icon without asking Paperless again.
            mimeType: metadata.mimeType,
            fileSize: null,
            storageRef: String(paperlessDocumentId),
            category: metadata.documentType,
            documentDate: parsePaperlessDate(metadata.createdAt),
            createdByUserId: userId,
            linkOriginManual: true,
          },
        });

        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            entityType: 'PolicyDocument',
            entityId: document.id,
            action: 'PAPERLESS_LINK_CREATED',
            diffJson: {
              policyId,
              paperlessDocumentId,
              title: document.fileName,
              category: document.category ?? null,
            } as Prisma.InputJsonValue,
          },
        });

        return this.applyManualLinkOrigin(tx, policyId, document, metadata);
      });
    } catch (error) {
      // P2002 (unique violation of the partial index) = a parallel request
      // has already created the same link: resolve idempotently.
      if ((error as { code?: string }).code === 'P2002') {
        const existing = await this.db.policyDocument.findFirst({
          where: {
            policyId,
            storageType: 'PAPERLESS_LINK',
            storageRef: String(paperlessDocumentId),
            archivedAt: null,
          },
        });
        if (existing) {
          linked = await this.db.$transaction((tx) =>
            this.applyManualLinkOrigin(tx, policyId, existing, metadata),
          );
        }
      }
      if (!linked) throw error;
    }

    if (linked.tagJobId) {
      await this.paperlessTags.enqueue(
        PAPERLESS_TAG_TAG_DOCUMENT_JOB,
        linked.tagJobId,
        policyId,
      );
    }
    return linked.document;
  }

  /**
   * AP-22: ensures the MANUAL origin is recorded and – when a policy tag is
   * configured – a durable TAG_DOCUMENT outbox row exists so the document
   * receives the tag in Paperless. Runs inside the caller's transaction so
   * the link and the job row are atomic.
   *
   * BugFix-21: `metadata` is the Paperless state fetched for this link. It is
   * used to fill metadata that is still missing on an existing row
   * (`mimeType`, `documentDate`); existing values are never overwritten.
   */
  private async applyManualLinkOrigin(
    tx: Prisma.TransactionClient,
    policyId: string,
    document: PolicyDocument,
    metadata: PaperlessDocumentMetadata,
  ): Promise<{ document: PolicyDocument; tagJobId: string | null }> {
    const tagConfig = await tx.policyPaperlessTag.findUnique({ where: { policyId } });

    // BugFix-21 (review #1): documents that were linked before the metadata
    // sync existed keep `mimeType = NULL` (and possibly no document date)
    // forever when the policy has no tag configured – no sync ever runs for
    // them. Linking is the only moment the current Paperless state is known,
    // so still-missing metadata is filled here. Existing values are never
    // overwritten: a manual link stays the user's record.
    const gaps: { mimeType?: string; documentDate?: Date } = {};
    if (!document.mimeType && metadata.mimeType) gaps.mimeType = metadata.mimeType;
    // BugFix-21 (review #2): a malformed external date is skipped, not written.
    const paperlessDate = parsePaperlessDate(metadata.createdAt);
    if (!document.documentDate && paperlessDate) gaps.documentDate = paperlessDate;

    if (!tagConfig) {
      // Without a configured tag the manual link behaves exactly as before.
      const data: Prisma.PolicyDocumentUpdateInput = { ...gaps };
      if (!document.linkOriginManual) data.linkOriginManual = true;
      // Nothing to record – stay write-free (idempotent re-link).
      if (Object.keys(data).length === 0) return { document, tagJobId: null };

      const updated = await tx.policyDocument.update({ where: { id: document.id }, data });
      return { document: updated, tagJobId: null };
    }

    // NOTE (round-4/round-5 review): neither `linkOriginTag` nor a previous
    // `taggingStatus === 'APPLIED'` may skip the assignment. Both are merely
    // *observations* that some earlier sync applied a tag – they do not record
    // which tag/configuration version they were verified against. Rows can
    // legitimately be APPLIED for a tag that has since been removed or
    // replaced (e.g. the manual origin was dropped, so `setTag`'s reset no
    // longer matches them), and such a row would then be excluded from
    // `scheduleManualLinkBackfill` and from `retryTagging` forever – it would
    // never receive the newly configured tag. Always queueing the assignment
    // is safe: the worker's `assignTagToDocument` verifies the tag and
    // short-circuits when it is already present, so the worst case is one
    // extra read.
    //
    // Reuse an already pending assignment instead of creating duplicates.
    const activeJob = await tx.paperlessTagJob.findFirst({
      where: {
        policyId,
        documentId: document.id,
        kind: 'TAG_DOCUMENT',
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });

    const updated = await tx.policyDocument.update({
      where: { id: document.id },
      data: {
        ...gaps,
        linkOriginManual: true,
        taggingStatus: 'PENDING',
        taggingErrorCode: null,
      },
    });

    if (activeJob) return { document: updated, tagJobId: null };

    const job = await tx.paperlessTagJob.create({
      data: {
        policyId,
        documentId: document.id,
        kind: 'TAG_DOCUMENT',
        status: 'PENDING',
        configVersion: tagConfig.configVersion,
      },
    });

    return { document: updated, tagJobId: job.id };
  }

  async findOne(householdId: string, user: AuthenticatedUser, policyId: string, docId: string) {
    // Throws 403/404 depending on role and share (READ_ONLY only with share)
    await this.authService.assertPolicyReadAccess(user, householdId, policyId);

    const document = await this.db.policyDocument.findFirst({
      where: { id: docId, policyId, archivedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
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
        throw new NotFoundException('Document not found');
      }

      const document = await tx.policyDocument.update({
        where: { id: docId },
        data: {
          fileName: dto.fileName !== undefined ? this.sanitizeFilename(dto.fileName) : undefined,
          category: dto.category,
          documentDate: dto.documentDate !== undefined
            ? (dto.documentDate ? new Date(dto.documentDate) : null)
            : undefined,
          // AP-24 (§2): nachträgliche Klassifikation; `undefined` lässt den
          // bisherigen Wert unangetastet.
          documentClass: dto.documentClass,
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

  /**
   * AP-24 (§2.3): changes the class of several documents of one policy in a
   * single step (bulk selection in the list).
   *
   * Scope and safety:
   * - Every ID is verified against `policyId` and the archive flag, so a
   *   request can never touch documents of another household/policy
   *   (mis-scoped IDs are reported as `notFound`, not silently applied).
   * - The update runs in one transaction: either all valid documents are
   *   reclassified or none.
   * - The change is audited with the affected IDs and both class values.
   */
  async classifyDocuments(
    householdId: string,
    userId: string,
    policyId: string,
    dto: BulkClassifyDocumentsDto,
  ) {
    await this.assertPolicyAccess(householdId, userId, policyId);

    if (dto.documentIds.length > MAX_BULK_CLASSIFY) {
      throw new BadRequestException(
        `A maximum of ${MAX_BULK_CLASSIFY} documents can be classified at once`,
      );
    }

    // De-duplicate: the same ID twice must not produce two audit entries.
    const documentIds = [...new Set(dto.documentIds)];

    return this.db.$transaction(async (tx) => {
      const existing = await tx.policyDocument.findMany({
        where: { id: { in: documentIds }, policyId, archivedAt: null },
        select: { id: true, documentClass: true },
      });

      const changedIds = existing
        .filter((doc) => doc.documentClass !== dto.documentClass)
        .map((doc) => doc.id);

      if (changedIds.length > 0) {
        await tx.policyDocument.updateMany({
          where: { id: { in: changedIds } },
          data: { documentClass: dto.documentClass },
        });

        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            entityType: 'PolicyDocument',
            entityId: policyId,
            action: 'BULK_CLASSIFY',
            diffJson: {
              documentClass: dto.documentClass,
              documentIds: changedIds,
              changed: changedIds.length,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        requested: documentIds.length,
        updated: changedIds.length,
        unchanged: existing.length - changedIds.length,
        notFound: documentIds.length - existing.length,
      };
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
        throw new NotFoundException('Document not found');
      }

      // AP-22: If the row carries both origins, only remove the manual link –
      // the automatic assignment (linkOriginTag) must survive and the document
      // stays visible until the next sync. Archive the row only when no
      // automatic origin remains.
      if (existing.linkOriginTag && existing.linkOriginManual) {
        await tx.policyDocument.update({
          where: { id: docId },
          data: { linkOriginManual: false },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            entityType: 'PolicyDocument',
            entityId: docId,
            action: 'UNLINK_MANUAL',
            diffJson: {
              linkOriginManual: false,
              linkOriginTag: existing.linkOriginTag,
            },
          },
        });
        return { success: true };
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
