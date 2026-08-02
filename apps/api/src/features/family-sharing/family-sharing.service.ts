import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { GlobalRole, ObjectShareScopeType, ObjectSharePermission } from '@prisma/client';
import { CreateShareDto, UpdateShareDto } from './dto/family-sharing.dto';
import { AuthService, AuthenticatedUser } from '../identity/auth.service';

@Injectable()
export class FamilySharingService {
  private readonly logger = new Logger(FamilySharingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  private async assertHouseholdAccess(householdId: string, userId: string): Promise<{ householdId: string; userId: string }> {
    const membership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }
    return membership;
  }

  /**
   * Erstellt eine neue Freigabe.
   * sourceUserId wird automatisch aus dem aktuellen User gesetzt.
   * targetUserId muss im selben Household aktiv sein.
   */
  async create(householdId: string, userId: string, dto: CreateShareDto) {
    await this.assertHouseholdAccess(householdId, userId);

    // Prüfen, dass targetUserId ebenfalls im Household ist.
    const targetMembership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId: dto.targetUserId } },
    });
    if (!targetMembership) {
      throw new BadRequestException('Zielbenutzer ist nicht Mitglied dieses Households');
    }

    if (dto.targetUserId === userId) {
      throw new BadRequestException('Freigabe an sich selbst ist nicht sinnvoll');
    }

    // Bei scoped shares (INSURANCE, DOCUMENT, CATEGORY) muss scopeRef gesetzt sein
    if (dto.scopeType !== ObjectShareScopeType.ALL_OWNED && !dto.scopeRef) {
      throw new BadRequestException('scopeRef ist für diesen scopeType erforderlich');
    }

    // Für ALL_OWNED darf scopeRef nicht gesetzt sein
    if (dto.scopeType === ObjectShareScopeType.ALL_OWNED && dto.scopeRef) {
      throw new BadRequestException('scopeRef darf bei ALL_OWNED nicht gesetzt sein');
    }

    // Bei INSURANCE-Scope: prüfen, ob die Policy existiert und zum Household gehört
    if (dto.scopeType === ObjectShareScopeType.INSURANCE && dto.scopeRef) {
      const policy = await this.db.insurancePolicy.findFirst({
        where: { id: dto.scopeRef, householdId },
      });
      if (!policy) {
        throw new NotFoundException('Versicherungspolice nicht gefunden');
      }
    }

    // Bei DOCUMENT-Scope: prüfen, ob das Dokument existiert und zum Household gehört
    if (dto.scopeType === ObjectShareScopeType.DOCUMENT && dto.scopeRef) {
      const document = await this.db.policyDocument.findFirst({
        where: {
          id: dto.scopeRef,
          policy: { householdId },
        },
      });
      if (!document) {
        throw new NotFoundException('Dokument nicht gefunden');
      }
    }

    // Auf doppelte Freigabe prüfen (gleicher source, target, scopeType, scopeRef)
    const existing = await this.db.objectShare.findFirst({
      where: {
        householdId,
        sourceUserId: userId,
        targetUserId: dto.targetUserId,
        scopeType: dto.scopeType,
        scopeRef: dto.scopeRef ?? null,
      },
    });
    if (existing) {
      throw new BadRequestException('Eine solche Freigabe existiert bereits');
    }

    return this.db.$transaction(async (tx) => {
      const share = await tx.objectShare.create({
        data: {
          householdId,
          sourceUserId: userId,
          targetUserId: dto.targetUserId,
          scopeType: dto.scopeType,
          scopeRef: dto.scopeRef ?? null,
          permission: dto.permission,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'ObjectShare',
          entityId: share.id,
          action: 'CREATE',
          diffJson: {
            targetUserId: dto.targetUserId,
            scopeType: dto.scopeType,
            scopeRef: dto.scopeRef ?? null,
            permission: dto.permission,
          },
        },
      });

      return share;
    }).catch((err) => {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`create share failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  /**
   * Listet alle Freigaben in einem Household.
   * READ_ONLY sieht ausschliesslich Freigaben, an denen der User beteiligt
   * ist (als Quelle oder Ziel) – er bekommt keinen Einblick in die
   * Freigaben anderer Household-Mitglieder.
   */
  async findAll(householdId: string, user: AuthenticatedUser) {
    await this.assertHouseholdAccess(householdId, user.id);

    const where =
      user.role === GlobalRole.READ_ONLY
        ? { householdId, OR: [{ sourceUserId: user.id }, { targetUserId: user.id }] }
        : { householdId };

    return this.db.objectShare.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Listet alle eingehenden Freigaben für den aktuellen User.
   */
  async findIncoming(householdId: string, userId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    return this.db.objectShare.findMany({
      where: { householdId, targetUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Listet alle ausgehenden Freigaben des aktuellen Users.
   */
  async findOutgoing(householdId: string, userId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    return this.db.objectShare.findMany({
      where: { householdId, sourceUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Aktualisiert die Berechtigung einer Freigabe.
   * Nur der Source-User kann die Freigabe ändern.
   */
  async update(householdId: string, userId: string, shareId: string, dto: UpdateShareDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const share = await this.db.objectShare.findFirst({
      where: { id: shareId, householdId },
    });

    if (!share) {
      throw new NotFoundException('Freigabe nicht gefunden');
    }

    if (share.sourceUserId !== userId) {
      throw new ForbiddenException('Nur der Eigentümer kann die Freigabe ändern');
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.objectShare.update({
        where: { id: shareId },
        data: { permission: dto.permission },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'ObjectShare',
          entityId: shareId,
          action: 'UPDATE',
          diffJson: {
            oldPermission: share.permission,
            newPermission: dto.permission,
          },
        },
      });

      return updated;
    }).catch((err) => {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(`update share ${shareId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  /**
   * Entzieht (löscht) eine Freigabe.
   * Der Entzug wirkt unmittelbar, da die Berechtigung zur Laufzeit geprüft wird.
   */
  async remove(householdId: string, user: AuthenticatedUser, shareId: string) {
    await this.assertHouseholdAccess(householdId, user.id);

    const share = await this.db.objectShare.findFirst({
      where: { id: shareId, householdId },
    });

    if (!share) {
      throw new NotFoundException('Freigabe nicht gefunden');
    }

    // Nur der Source-User oder ein globaler ADMIN kann eine Freigabe entziehen
    const isSource = share.sourceUserId === user.id;
    const isGlobalAdmin = user.role === GlobalRole.ADMIN;

    if (!isSource && !isGlobalAdmin) {
      throw new ForbiddenException('Nicht berechtigt, diese Freigabe zu entziehen');
    }

    return this.db.$transaction(async (tx) => {
      await tx.objectShare.delete({ where: { id: shareId } });

      await tx.auditEvent.create({
        data: {
          actorUserId: user.id,
          entityType: 'ObjectShare',
          entityId: shareId,
          action: 'DELETE',
          diffJson: {
            sourceUserId: share.sourceUserId,
            targetUserId: share.targetUserId,
            scopeType: share.scopeType,
            scopeRef: share.scopeRef,
            permission: share.permission,
          },
        },
      });

      return { success: true };
    }).catch((err) => {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      this.logger.error(`remove share ${shareId} failed: ${err.message}`, err.stack);
      throw err;
    });
  }

  /**
   * Prüft, ob ein User auf ein bestimmtes Objekt zugreifen darf.
   * Wird von anderen Features (Policies, Dokumente) als Permission-Guard verwendet.
   *
   * Berechtigungslogik:
   * 1. User ist Owner des Objekts -> Zugriff erlaubt
   * 2. Es existiert eine Freigabe vom Owner zum User mit passendem Scope
   * 3. ALL_OWNED deckt alle Objekte des Owners ab
   * 4. CATEGORY deckt alle Objekte einer Kategorie ab
   * 5. INSURANCE/DOCUMENT deckt das konkrete Objekt ab
   */
  async checkPermission(
    householdId: string,
    requestingUserId: string,
    ownerUserId: string,
    scopeType: ObjectShareScopeType,
    scopeRef: string,
    requiredPermission: ObjectSharePermission,
  ): Promise<boolean> {
    // Fall 1: Der anfragende User ist der Owner -> immer Zugriff
    if (requestingUserId === ownerUserId) {
      return true;
    }

    // Fall 2: Prüfen auf bestehende Freigabe
    const shares = await this.db.objectShare.findMany({
      where: {
        householdId,
        sourceUserId: ownerUserId,
        targetUserId: requestingUserId,
        permission: requiredPermission,
      },
    });

    for (const share of shares) {
      if (share.scopeType === ObjectShareScopeType.ALL_OWNED) {
        return true;
      }
      if (share.scopeType === scopeType && share.scopeRef === scopeRef) {
        return true;
      }
      if (share.scopeType === ObjectShareScopeType.CATEGORY && scopeType === ObjectShareScopeType.INSURANCE) {
        // CATEGORY-Freigaben auf Insurance-Ebene: scopeRef ist die Kategorie der Police
        const policy = await this.db.insurancePolicy.findUnique({
          where: { id: scopeRef },
          select: { type: true },
        });
        if (policy && share.scopeRef === policy.type) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Findet eine einzelne Freigabe.
   * READ_ONLY darf nur Freigaben sehen, an denen er beteiligt ist.
   */
  async findOne(householdId: string, user: AuthenticatedUser, shareId: string) {
    await this.assertHouseholdAccess(householdId, user.id);

    const share = await this.db.objectShare.findFirst({
      where: { id: shareId, householdId },
    });

    if (!share) {
      throw new NotFoundException('Freigabe nicht gefunden');
    }

    if (
      user.role === GlobalRole.READ_ONLY &&
      share.sourceUserId !== user.id &&
      share.targetUserId !== user.id
    ) {
      throw new ForbiddenException('Nicht berechtigt, diese Freigabe zu sehen');
    }

    return share;
  }
}
