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
      throw new ForbiddenException('Isolation: no access to a foreign household');
    }
    return membership;
  }

  /**
   * Lists the other members of a household (id, username, displayName,
   * role). Serves as the target picker for the share UI. The calling user
   * itself is excluded. Only USER/ADMIN may call this endpoint
   * (RolesGuard); READ_ONLY members never see the complete member list.
   */
  async listMembers(householdId: string, userId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    const memberships = await this.db.householdMembership.findMany({
      where: { householdId },
      include: {
        user: { select: { id: true, username: true, displayName: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships
      .filter((m) => m.userId !== userId)
      .map((m) => m.user);
  }

  /**
   * Creates a new share.
   * sourceUserId is set automatically from the current user.
   * targetUserId must be active in the same household.
   */
  async create(householdId: string, userId: string, dto: CreateShareDto) {
    await this.assertHouseholdAccess(householdId, userId);

    // Verify that targetUserId is also in the household.
    const targetMembership = await this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId: dto.targetUserId } },
    });
    if (!targetMembership) {
      throw new BadRequestException('Target user is not a member of this household');
    }

    if (dto.targetUserId === userId) {
      throw new BadRequestException('Sharing with yourself is not meaningful');
    }

    // For scoped shares (INSURANCE, DOCUMENT, CATEGORY), scopeRef must be set
    if (dto.scopeType !== ObjectShareScopeType.ALL_OWNED && !dto.scopeRef) {
      throw new BadRequestException('scopeRef is required for this scopeType');
    }

    // For ALL_OWNED scopeRef must not be set
    if (dto.scopeType === ObjectShareScopeType.ALL_OWNED && dto.scopeRef) {
      throw new BadRequestException('scopeRef must not be set for ALL_OWNED');
    }

    // For INSURANCE scope: verify the policy exists and belongs to the household
    if (dto.scopeType === ObjectShareScopeType.INSURANCE && dto.scopeRef) {
      const policy = await this.db.insurancePolicy.findFirst({
        where: { id: dto.scopeRef, householdId },
      });
      if (!policy) {
        throw new NotFoundException('Policy not found');
      }
    }

    // For DOCUMENT scope: verify the document exists and belongs to the household
    if (dto.scopeType === ObjectShareScopeType.DOCUMENT && dto.scopeRef) {
      const document = await this.db.policyDocument.findFirst({
        where: {
          id: dto.scopeRef,
          policy: { householdId },
        },
      });
      if (!document) {
        throw new NotFoundException('Document not found');
      }
    }

    // Check for duplicate share (same source, target, scopeType, scopeRef)
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
      throw new BadRequestException('Such a share already exists');
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
   * Lists all shares in a household.
   * READ_ONLY sees exclusively shares in which the user is involved (as
   * source or target) - it gets no insight into the shares of other
   * household members.
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
   * Lists all incoming shares for the current user.
   */
  async findIncoming(householdId: string, userId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    return this.db.objectShare.findMany({
      where: { householdId, targetUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Lists all outgoing shares of the current user.
   */
  async findOutgoing(householdId: string, userId: string) {
    await this.assertHouseholdAccess(householdId, userId);

    return this.db.objectShare.findMany({
      where: { householdId, sourceUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Updates the permission of a share.
   * Only the source user can change the share.
   */
  async update(householdId: string, userId: string, shareId: string, dto: UpdateShareDto) {
    await this.assertHouseholdAccess(householdId, userId);

    const share = await this.db.objectShare.findFirst({
      where: { id: shareId, householdId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (share.sourceUserId !== userId) {
      throw new ForbiddenException('Only the owner can change the share');
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
   * Revokes (deletes) a share.
   * The revocation takes effect immediately because permissions are
   * checked at runtime.
   */
  async remove(householdId: string, user: AuthenticatedUser, shareId: string) {
    await this.assertHouseholdAccess(householdId, user.id);

    const share = await this.db.objectShare.findFirst({
      where: { id: shareId, householdId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    // Only the source user or a global ADMIN can revoke a share
    const isSource = share.sourceUserId === user.id;
    const isGlobalAdmin = user.role === GlobalRole.ADMIN;

    if (!isSource && !isGlobalAdmin) {
      throw new ForbiddenException('Not authorized to revoke this share');
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
   * Checks whether a user may access a specific object.
   * Used by other features (policies, documents) as a permission guard.
   *
   * Permission logic:
   * 1. User is the owner of the object -> access allowed
   * 2. A share exists from the owner to the user with a matching scope
   * 3. ALL_OWNED covers all objects of the owner
   * 4. CATEGORY covers all objects of a category
   * 5. INSURANCE/DOCUMENT covers the concrete object
   */
  async checkPermission(
    householdId: string,
    requestingUserId: string,
    ownerUserId: string,
    scopeType: ObjectShareScopeType,
    scopeRef: string,
    requiredPermission: ObjectSharePermission,
  ): Promise<boolean> {
    // Case 1: the requesting user is the owner -> always allow
    if (requestingUserId === ownerUserId) {
      return true;
    }

    // Case 2: check for an existing share
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
        // CATEGORY shares at the insurance level: scopeRef is the policy's category
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
   * Finds a single share.
   * READ_ONLY may only see shares in which it is involved.
   */
  async findOne(householdId: string, user: AuthenticatedUser, shareId: string) {
    await this.assertHouseholdAccess(householdId, user.id);

    const share = await this.db.objectShare.findFirst({
      where: { id: shareId, householdId },
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (
      user.role === GlobalRole.READ_ONLY &&
      share.sourceUserId !== user.id &&
      share.targetUserId !== user.id
    ) {
      throw new ForbiddenException('Not authorized to view this share');
    }

    return share;
  }
}
