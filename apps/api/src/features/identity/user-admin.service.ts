import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { GlobalRole, Prisma, UserStatus } from '@prisma/client';
import { AuthenticatedUser } from './auth.service';
import { DEFAULT_HOUSEHOLD_ID } from './local-admin.bootstrap';
import { ListUsersQueryDto } from './user-admin.dto';
import { normalizeIssuerUrl } from './oidc.strategy';

export interface AdminUserListItem {
  id: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  status: UserStatus;
  email: string | null;
  hasCredential: boolean;
  oidcIssuer: string | null;
  oidcSubject: string | null;
  createdAt: Date;
}

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  status: true,
  email: true,
  oidcIssuer: true,
  oidcSubject: true,
  createdAt: true,
  credential: { select: { id: true } },
} satisfies Prisma.UserSelect;

/**
 * Admin management of local accounts (ADRs 005-007):
 * - Approval (approve) and rejection (reject) of new registrations
 * - Disabling (disable) and enabling (enable) of accounts
 * - Setting the global role (GlobalRole)
 * - Binding/unbinding an OIDC identity to a local account
 *
 * Protection rules:
 * - Last-admin protection: the last active ADMIN can neither be disabled
 *   nor demoted (serializable transaction).
 * - Every change is logged in the audit event log.
 */
@Injectable()
export class UserAdminService {
  private readonly logger = new Logger(UserAdminService.name);

  constructor(private readonly db: DatabaseService) {}

  async list(query: ListUsersQueryDto): Promise<{ users: AdminUserListItem[]; total: number }> {
    const where: Prisma.UserWhereInput = query.status ? { status: query.status } : {};

    const [users, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: {
          ...userSelect,
        },
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
      }),
      this.db.user.count({ where }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        status: u.status,
        email: u.email,
        hasCredential: u.credential !== null,
        oidcIssuer: u.oidcIssuer,
        oidcSubject: u.oidcSubject,
        createdAt: u.createdAt,
      })),
      total,
    };
  }

  /**
   * Activates an account with status PENDING_APPROVAL (ACTIVE).
   *
   * AP-20: the approved user is also added to the beta reference
   * Household "default" (if it exists), so the household-scoped UI
   * functions are actually usable for the account. In pure OIDC operation
   * modes without bootstrap the household may be missing – then the
   * membership is skipped.
   */
  async approve(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw new NotFoundException('User not found');
      if (user.status !== UserStatus.PENDING_APPROVAL) {
        throw new ConflictException('Only accounts pending approval (PENDING_APPROVAL) can be approved');
      }

      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });

      const defaultHousehold = await tx.household.findUnique({
        where: { id: DEFAULT_HOUSEHOLD_ID },
        select: { id: true },
      });
      if (defaultHousehold) {
        await tx.householdMembership.upsert({
          where: {
            householdId_userId: {
              householdId: DEFAULT_HOUSEHOLD_ID,
              userId,
            },
          },
          create: { householdId: DEFAULT_HOUSEHOLD_ID, userId },
          update: {},
        });
      }

      await this.audit(tx, admin, userId, 'USER_APPROVED', { status: 'ACTIVE' });
    });
  }

  /**
   * Rejects an account with status PENDING_APPROVAL (DISABLED).
   */
  async reject(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw new NotFoundException('User not found');
      if (user.status !== UserStatus.PENDING_APPROVAL) {
        throw new ConflictException('Only accounts pending approval (PENDING_APPROVAL) can be rejected');
      }

      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.DISABLED } });
      await this.audit(tx, admin, userId, 'USER_REJECTED', { status: 'DISABLED' });
    });
  }

/**
 * Runs a callback in a serializable transaction and translates Prisma
 * error P2034 (serialization conflict / deadlock) into a
 * ConflictException. Since the last-admin check is race-sensitive, the
 * operation is retried a limited number of times on P2034 before a 409
 * is reported (instead of an unhandled 500).
 */
private async runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await this.db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2034' && attempt < MAX_ATTEMPTS) {
        // Serialization conflict: retry
        lastError = error;
        continue;
      }
      if (code === 'P2034') {
        throw new ConflictException(
          'Concurrent change detected. Please try again.',
        );
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Disables an active account (DISABLED). The last active ADMIN cannot
 * be disabled (last-admin protection).
 */
async disable(admin: AuthenticatedUser, userId: string): Promise<void> {
  if (admin.id === userId) {
    throw new ConflictException('You cannot disable yourself');
  }

  await this.runSerializable(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new ConflictException('Only active accounts can be disabled');
    }

    await this.assertNotLastActiveAdmin(tx, user.role);
    await tx.user.update({ where: { id: userId }, data: { status: UserStatus.DISABLED } });
    await this.audit(tx, admin, userId, 'USER_DISABLED', { status: 'DISABLED' });
  });
}

  /**
   * Enables a disabled account (ACTIVE).
   */
  async enable(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw new NotFoundException('User not found');
      if (user.status !== UserStatus.DISABLED) {
        throw new ConflictException('Only disabled accounts can be enabled');
      }

      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      await this.audit(tx, admin, userId, 'USER_ENABLED', { status: 'ACTIVE' });
    });
  }

  /**
   * Sets the global role of a user. When demoting the last active ADMIN
   * the last-admin protection applies.
   */
  async setRole(admin: AuthenticatedUser, userId: string, role: GlobalRole): Promise<void> {
    await this.runSerializable(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, role: true },
      });
      if (!user) throw new NotFoundException('User not found');
      if (user.role === role) {
        throw new ConflictException('Role is already set');
      }

      const isDowngradeFromAdmin = user.role === GlobalRole.ADMIN && role !== GlobalRole.ADMIN;
      if (isDowngradeFromAdmin) {
        await this.assertNotLastActiveAdmin(tx, user.role);
      }

      await tx.user.update({ where: { id: userId }, data: { role } });
      await this.audit(tx, admin, userId, 'USER_ROLE_CHANGED', { from: user.role, to: role });
    });
  }

  /**
   * Binds an OIDC identity (issuer, subject) to a local account.
   * The UNIQUE constraint (oidcIssuer, oidcSubject) prevents the same
   * identity from being bound to two accounts.
   */
  async bindOidcIdentity(
    admin: AuthenticatedUser,
    userId: string,
    oidcIssuer: string,
    oidcSubject: string,
  ): Promise<void> {
    try {
      await this.db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw new NotFoundException('User not found');

        // Normalize trailing-slash variance so the stored binding can be
        // found again regardless of a trailing slash at login (claims.iss,
        // also normalized) (ADR-007).
        await tx.user.update({
          where: { id: userId },
          data: { oidcIssuer: normalizeIssuerUrl(oidcIssuer), oidcSubject },
        });
        await this.audit(tx, admin, userId, 'OIDC_BOUND', { oidcIssuer });
      });
    } catch (error) {
      // P2002: (oidcIssuer, oidcSubject) is already bound to another account
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('This OIDC identity is already bound to another account');
      }
      throw error;
    }
  }

  /**
   * Unbinds the OIDC identity of an account (only the binding, never the
   * account).
   */
  async unbindOidcIdentity(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { oidcIssuer: true },
      });
      if (!user) throw new NotFoundException('User not found');
      if (!user.oidcIssuer) {
        throw new ConflictException('Account has no OIDC binding');
      }

      await tx.user.update({ where: { id: userId }, data: { oidcIssuer: null, oidcSubject: null } });
      await this.audit(tx, admin, userId, 'OIDC_UNBOUND', {});
    });
  }

  /**
   * Last-admin protection: throws a ConflictException if the target user
   * is the last remaining active ADMIN (only relevant for active ADMINs).
   */
  private async assertNotLastActiveAdmin(
    tx: Prisma.TransactionClient,
    targetRole: GlobalRole,
  ): Promise<void> {
    if (targetRole !== GlobalRole.ADMIN) return;

    const activeAdmins = await tx.user.count({
      where: { role: GlobalRole.ADMIN, status: UserStatus.ACTIVE },
    });
    if (activeAdmins <= 1) {
      throw new ConflictException('The last active administrator cannot be changed');
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    admin: AuthenticatedUser,
    userId: string,
    action: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    try {
      await tx.auditEvent.create({
        data: {
          actorUserId: admin.id,
          entityType: 'User',
          entityId: userId,
          action,
          diffJson: diff as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit entry failed: ${(error as Error).message}`);
    }
  }
}
