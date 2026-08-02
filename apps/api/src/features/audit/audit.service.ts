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
  /** true, wenn ein Diff hinterlegt ist – der Inhalt wird in der Liste NIE ausgegeben. */
  hasDiff: boolean;
}

export interface AuditEventDetail extends AuditEventListItem {
  diffJson: Prisma.JsonValue | null;
}

/**
 * Audit-Event-Zugriff (AP-19).
 *
 * Die Liste liefert bewusst KEINE diffJson-Inhalte mit: Diffs koennen
 * personenbezogene Metadaten enthalten (z. B. Dateinamen). Die Detail-
 * Abfrage ist ausschliesslich fuer globale ADMINs gedacht (Controller-Rolle)
 * und gibt den redigierten Diff zurueck (bestehende Audit-Redaction-Policy:
 * Secrets/Werte werden bereits beim Schreiben nicht in Diffs gespeichert).
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
      throw new NotFoundException('Audit-Event nicht gefunden');
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
   * Zentraler Audit-Eintrag fuer neue Feature-Aktionen (fail-soft: Ein
   * fehlgeschlagener Audit-Eintrag blockiert die Fachaktion nicht, wird
   * aber geloggt – konsistent zur bisherigen Praxis in den Features).
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
        `Audit-Eintrag fehlgeschlagen (${params.action}): ${(error as Error).message}`,
      );
    }
  }
}
