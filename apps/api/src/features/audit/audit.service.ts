import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { Prisma } from '@prisma/client';
import { ListAuditEventsQueryDto } from './audit.dto';

export interface AuditEventListItem {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: string;
  /** true when a diff is stored – its content is NEVER returned in the list. */
  hasDiff: boolean;
}

export interface AuditEventDetail extends AuditEventListItem {
  diffJson: Prisma.JsonValue | null;
}

/**
 * Audit event access (AP-19).
 *
 * The list deliberately does NOT include diffJson content: diffs can
 * contain personal metadata (e.g. file names). The detail query is
 * intended exclusively for global ADMINs (controller role) and returns
 * the redacted diff (existing audit redaction policy: secrets/values are
 * not stored in diffs at write time).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async listEvents(
    query: ListAuditEventsQueryDto,
  ): Promise<{ events: AuditEventListItem[]; total: number }> {
    const where: Prisma.AuditEventWhereInput = {};

    if (query.entityType) where.entityType = query.entityType;
    if (query.action) where.action = query.action;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [events, total] = await this.db.$transaction([
      this.db.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(query.take ?? 50, 200),
        skip: query.skip ?? 0,
        select: {
          id: true,
          actorUserId: true,
          entityType: true,
          entityId: true,
          action: true,
          createdAt: true,
          diffJson: true,
          actorUser: { select: { username: true } },
        },
      }),
      this.db.auditEvent.count({ where }),
    ]);

    return {
      events: events.map((event) => ({
        id: event.id,
        actorUserId: event.actorUserId,
        actorUsername: event.actorUser?.username ?? null,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        createdAt: event.createdAt.toISOString(),
        hasDiff: event.diffJson !== null && event.diffJson !== undefined,
      })),
      total,
    };
  }

  async getEvent(id: string): Promise<AuditEventDetail> {
    const event = await this.db.auditEvent.findUnique({
      where: { id },
      select: {
        id: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        action: true,
        createdAt: true,
        diffJson: true,
        actorUser: { select: { username: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Audit event not found');
    }

    return {
      id: event.id,
      actorUserId: event.actorUserId,
      actorUsername: event.actorUser?.username ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
      hasDiff: event.diffJson !== null && event.diffJson !== undefined,
      diffJson: event.diffJson,
    };
  }

  /**
   * Central audit entry for new feature actions (fail-soft: a failed
   * audit entry does not block the business action; it is
   * but logged – consistent with previous practice in the features).
   */
  async record(params: {
    actorUserId: string;
    entityType: string;
    entityId: string;
    action: string;
    diff?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.auditEvent.create({
        data: {
          actorUserId: params.actorUserId,
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          diffJson: params.diff ? (params.diff as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Audit entry failed (${params.action}): ${(error as Error).message}`,
      );
    }
  }
}
