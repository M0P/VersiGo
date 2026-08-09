import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import type { Prisma } from '@prisma/client';
import {
  GlobalRole,
  InsurancePolicyType,
  ObjectSharePermission,
  ObjectShareScopeType,
  UserStatus,
} from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';
// BugFix-09 (CI fix): NO top-level import from './oidc.strategy' here!
// auth.service and oidc.strategy form a circular module graph (oidc.strategy
// VALUE-imports AuthService because `design:paramtypes` must reference the
// class at runtime for NestJS DI - see the import in oidc.strategy.ts). A
// top-level import of normalizeIssuerUrl would emit a top-level
// `require("./oidc.strategy")` in auth.service.js; with the module
// evaluation order (identity.module -> auth.controller -> auth.service ->
// oidc.strategy -> auth.service) AuthService is not yet assigned while
// oidc.strategy is evaluated, and Nest DI fails at API boot with
// `UndefinedDependencyException` (BugFix-07 regression, verified as the
// root cause of the CI failure "API not healthy"). Therefore only lazy,
// method-level access is allowed here (await import) - at call time the
// oidc.strategy module is guaranteed to be fully evaluated.

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  status: UserStatus;
  memberships: { householdId: string }[];
}

/**
 * Normalize a local login identifier (username) for storage and lookup.
 * Applies lowercasing and trimming to provide case-insensitive
 * uniqueness without storing multiple variants.
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/**
 * Username validation (after normalization).
 * Allows 3-32 characters from [a-z0-9._-], starting with a letter/digit.
 * ASCII-only: avoids homoglyph/umlaut problems with login identifiers.
 */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/**
 * Password policy: at least 12 characters, at most 128 characters.
 * No further complexity rules (length is the most effective factor).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface RegisterLocalAccountInput {
  username: string;
  displayName: string;
  password: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly passwordHashing: PasswordHashingService,
  ) {}

  private toAuthenticatedUser(user: {
    id: string;
    username: string;
    displayName: string;
    role: GlobalRole;
    status: UserStatus;
    memberships: { householdId: string }[];
  }): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      memberships: user.memberships.map((m) => ({ householdId: m.householdId })),
    };
  }

  async findById(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        memberships: { select: { householdId: true } },
      },
    });

    if (!user) {
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  async getMembership(
    userId: string,
    householdId: string,
  ): Promise<{ householdId: string; userId: string } | null> {
    return this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
  }

  /**
   * Finds a user via their bound OIDC identity (ADR-007).
   * OIDC does not provision accounts: without a (or with a locked) bound
   * account null is returned so the OIDC login fails generically.
   */
  async findByOidcIdentity(
    oidcIssuer: string,
    oidcSubject: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.db.user.findUnique({
      where: { oidcIssuer_oidcSubject: { oidcIssuer, oidcSubject } },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        memberships: { select: { householdId: true } },
      },
    });

    if (!user) {
      this.logger.warn(`OIDC login rejected for unbound identity (issuer=${oidcIssuer})`);
      return null;
    }
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`OIDC login rejected for inactive account ${user.id}`);
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  /**
   * BugFix-07 (self-service linking): returns the current OIDC binding of
   * an account (null if none exists). Only the user itself may read its
   * own binding (called from the authenticated AuthController).
   */
  async getOidcBinding(userId: string): Promise<{ oidcIssuer: string; oidcSubject: string } | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { oidcIssuer: true, oidcSubject: true },
    });
    if (!user || !user.oidcIssuer || !user.oidcSubject) {
      return null;
    }
    return { oidcIssuer: user.oidcIssuer, oidcSubject: user.oidcSubject };
  }

  /**
   * BugFix-07 (self-service linking): binds the OIDC identity confirmed in
   * the link callback to the signed-in user. Replaces an existing binding
   * of the same account; if the identity is already bound to ANOTHER
   * account, a ConflictException is thrown (UNIQUE constraint
   * (oidcIssuer, oidcSubject)). No provisioning: without an existing
   * account there is nothing to bind.
   */
  async bindOidcIdentityForUser(
    userId: string,
    oidcIssuer: string,
    oidcSubject: string,
  ): Promise<{ oidcIssuer: string; oidcSubject: string }> {
    // BugFix-07 (code review, R2): shared normalization instead of an
    // inline duplicate so admin binding, self-service binding and the login
    // comparison never diverge (ADR-007).
    // BugFix-09 (CI fix): lazy, method-level import instead of a top-level
    // import - avoids the auth.service <-> oidc.strategy module-evaluation
    // cycle (see comment above). At call time the oidc.strategy module is
    // guaranteed to be fully evaluated.
    const { normalizeIssuerUrl } = await import('./oidc.strategy');
    const normalizedIssuer = normalizeIssuerUrl(oidcIssuer);
    try {
      const result = await this.db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw new NotFoundException('User not found');

        await tx.user.update({
          where: { id: userId },
          data: { oidcIssuer: normalizedIssuer, oidcSubject },
        });
        return { oidcIssuer: normalizedIssuer, oidcSubject };
      });

      await this.auditOidcSelf(userId, 'OIDC_BOUND_SELF', { oidcIssuer: normalizedIssuer });
      return result;
    } catch (error) {
      // P2002: (oidcIssuer, oidcSubject) is already bound to another account
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'This OIDC identity is already bound to another account',
        );
      }
      throw error;
    }
  }

  /**
   * BugFix-07 (self-service linking): removes the OIDC binding of the
   * signed-in account (only the binding, never the account). Throws
   * ConflictException when no binding exists.
   */
  async unbindOidcIdentityForUser(userId: string): Promise<void> {
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
    });

    await this.auditOidcSelf(userId, 'OIDC_UNBOUND_SELF', {});
  }

  private async auditOidcSelf(
    actorUserId: string,
    action: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.db.auditEvent
      .create({
        data: {
          actorUserId,
          entityType: 'User',
          entityId: actorUserId,
          action,
          diffJson: diff as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        /* audit is non-critical */
      });
  }

  /**
   * Registers a new local account. The account is created with the status
   * PENDING_APPROVAL and is locked until an admin approves it (neither
   * local nor OIDC login is possible).
   *
   * Throws ConflictException when the username is already taken. Password
   * values are never stored, logged or audited.
   */
  async registerLocalAccount(input: RegisterLocalAccountInput): Promise<{ id: string }> {
    const username = normalizeIdentifier(input.username);
    const displayName = input.displayName.trim();
    const password = input.password;

    const passwordHash = await this.passwordHashing.hash(password);

    try {
      return await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username,
            displayName,
            role: GlobalRole.USER,
            status: UserStatus.PENDING_APPROVAL,
          },
          select: { id: true },
        });

        await tx.credential.create({
          data: {
            userId: user.id,
            passwordHash,
          },
        });

        await tx.auditEvent.create({
          data: {
            actorUserId: null,
            entityType: 'User',
            entityId: user.id,
            action: 'REGISTER_PENDING',
            diffJson: { username },
          },
        });

        return user;
      });
    } catch (error) {
      // P2002: users_username_key bereits belegt
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Username is already taken');
      }
      throw error;
    }
  }

  /**
   * Attempts local login with username and password.
   *
   * Returns the authenticated user on success, otherwise null (generic -
   * without revealing whether the username exists, the password was wrong
   * or the account is locked/pending approval).
   */
  async localLogin(username: string, password: string): Promise<AuthenticatedUser | null> {
    const normalized = normalizeIdentifier(username);

    const user = await this.db.user.findUnique({
      where: { username: normalized },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        memberships: { select: { householdId: true } },
        credential: { select: { passwordHash: true } },
      },
    });

    // Generic error path: reveal neither user existence nor status.
    if (!user || user.status !== UserStatus.ACTIVE || !user.credential) {
      if (user && user.status !== UserStatus.ACTIVE) {
        this.logger.warn(
          `Login rejected for inactive account ${user.id} (status ${user.status})`,
        );
      }
      await this.auditAuthFailure(user?.id ?? null);
      return null;
    }

    const valid = await this.passwordHashing.verify(password, user.credential.passwordHash);
    if (!valid) {
      await this.auditAuthFailure(null);
      return null;
    }

    await this.auditAuthSuccess(user.id);
    return this.toAuthenticatedUser(user);
  }

  private async auditAuthFailure(actorUserId: string | null): Promise<void> {
    await this.db.auditEvent
      .create({
        data: {
          actorUserId,
          entityType: 'AuthEvent',
          entityId: 'unknown',
          action: 'LOCAL_LOGIN_FAILURE',
        },
      })
      .catch(() => {
        /* audit is non-critical */
      });
  }

  private async auditAuthSuccess(actorUserId: string): Promise<void> {
    await this.db.auditEvent
      .create({
        data: {
          actorUserId,
          entityType: 'AuthEvent',
          entityId: actorUserId,
          action: 'LOCAL_LOGIN_SUCCESS',
        },
      })
      .catch(() => {
        /* audit is non-critical */
      });
  }

  /**
   * Checks whether a user may read a policy.
   *
   * - Every access requires household membership (isolation).
   * - USER/ADMIN may read all policies of their household (the existing
   *   permission framework stays unchanged).
   * - READ_ONLY may read exclusively explicitly shared policies
   *   (INSURANCE-/CATEGORY-/ALL_OWNED share with permission READ) - even
   *   own historical data is not visible without a share (AP-16).
   */
  async assertPolicyReadAccess(
    user: AuthenticatedUser,
    householdId: string,
    policyId: string,
  ): Promise<void> {
    const membership = await this.getMembership(user.id, householdId);
    if (!membership) {
      throw new ForbiddenException('Isolation: no access to a foreign household');
    }

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
      select: { id: true },
    });
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    if (user.role === GlobalRole.READ_ONLY) {
      const readable = await this.hasPolicyReadShare(householdId, user.id, policyId);
      if (!readable) {
        throw new ForbiddenException('No read share for this policy');
      }
    }
  }

  /**
   * Returns the policy IDs readable by the user for a household.
   * Returns null for USER/ADMIN (all policies of the household).
   * For READ_ONLY only the policies explicitly shared with READ are
   * returned.
   */
  async getReadablePolicyIds(
    user: AuthenticatedUser,
    householdId: string,
  ): Promise<string[] | null> {
    if (user.role !== GlobalRole.READ_ONLY) {
      return null;
    }

    const shares = await this.db.objectShare.findMany({
      where: {
        householdId,
        targetUserId: user.id,
        permission: ObjectSharePermission.READ,
      },
      select: { scopeType: true, scopeRef: true, sourceUserId: true },
    });

    const insuranceRefs = shares
      .filter((s) => s.scopeType === ObjectShareScopeType.INSURANCE && s.scopeRef)
      .map((s) => s.scopeRef as string);
    const categoryRefs = shares
      .filter((s) => s.scopeType === ObjectShareScopeType.CATEGORY && s.scopeRef)
      .map((s) => s.scopeRef as InsurancePolicyType);
    const allOwnedSources = shares
      .filter((s) => s.scopeType === ObjectShareScopeType.ALL_OWNED)
      .map((s) => s.sourceUserId);

    if (insuranceRefs.length === 0 && categoryRefs.length === 0 && allOwnedSources.length === 0) {
      return [];
    }

    const policies = await this.db.insurancePolicy.findMany({
      where: {
        householdId,
        archivedAt: null,
        OR: [
          { id: { in: insuranceRefs } },
          { type: { in: categoryRefs } },
          { ownerUserId: { in: allOwnedSources } },
        ],
      },
      select: { id: true },
    });

    return policies.map((p) => p.id);
  }

  private async hasPolicyReadShare(
    householdId: string,
    targetUserId: string,
    policyId: string,
  ): Promise<boolean> {
    const shares = await this.db.objectShare.findMany({
      where: {
        householdId,
        targetUserId,
        permission: ObjectSharePermission.READ,
      },
      select: { scopeType: true, scopeRef: true, sourceUserId: true },
    });

    const insuranceRefs = shares
      .filter((s) => s.scopeType === ObjectShareScopeType.INSURANCE && s.scopeRef)
      .map((s) => s.scopeRef as string);
    const categoryRefs = shares
      .filter((s) => s.scopeType === ObjectShareScopeType.CATEGORY && s.scopeRef)
      .map((s) => s.scopeRef as InsurancePolicyType);
    const allOwnedSources = shares
      .filter((s) => s.scopeType === ObjectShareScopeType.ALL_OWNED)
      .map((s) => s.sourceUserId);

    if (insuranceRefs.length === 0 && categoryRefs.length === 0 && allOwnedSources.length === 0) {
      return false;
    }

    const policy = await this.db.insurancePolicy.findFirst({
      where: {
        id: policyId,
        householdId,
        OR: [
          { id: { in: insuranceRefs } },
          { type: { in: categoryRefs } },
          { ownerUserId: { in: allOwnedSources } },
        ],
      },
      select: { id: true },
    });

    return policy !== null;
  }
}
