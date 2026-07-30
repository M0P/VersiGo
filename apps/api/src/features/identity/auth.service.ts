import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@insura/foundation';
import { HouseholdRole, UserStatus } from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';

export interface OidcClaimsInput {
  oidcIssuer: string;
  oidcSubject: string;
  email: string;
  displayName: string;
  locale: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  memberships: { householdId: string; role: HouseholdRole }[];
}

/**
 * Normalize a local login identifier for storage and lookup.
 * Applies lowercasing and trimming to provide case-insensitive
 * uniqueness without storing multiple variants.
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly passwordHashing: PasswordHashingService,
  ) {}

  async upsertFromOidcClaims(input: OidcClaimsInput): Promise<AuthenticatedUser> {
    const user = await this.db.user.upsert({
      where: {
        oidcIssuer_oidcSubject: {
          oidcIssuer: input.oidcIssuer,
          oidcSubject: input.oidcSubject,
        },
      },
      update: {
        displayName: input.displayName,
        locale: input.locale,
      },
      create: {
        oidcIssuer: input.oidcIssuer,
        oidcSubject: input.oidcSubject,
        email: input.email,
        displayName: input.displayName,
        locale: input.locale,
        status: UserStatus.ACTIVE,
      },
      include: { memberships: true },
    });

    if (user.status === UserStatus.DISABLED) {
      this.logger.warn(`Deaktivierter User ${user.id} versuchte Login`);
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      memberships: user.memberships.map((m) => ({
        householdId: m.householdId,
        role: m.role,
      })),
    };
  }

  async getMembership(
    userId: string,
    householdId: string,
  ): Promise<{ householdId: string; userId: string; role: HouseholdRole } | null> {
    return this.db.householdMembership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
  }

  async findById(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { memberships: true },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      memberships: user.memberships.map((m) => ({
        householdId: m.householdId,
        role: m.role,
      })),
    };
  }

  /**
   * Attempt local login with identifier and password.
   *
   * Returns the authenticated user on success, or null on failure.
   * Uses a generic return value that does not reveal whether the
   * identifier exists or the password was wrong.
   *
   * The identifier is normalized before lookup (lowercased, trimmed).
   */
  async localLogin(
    identifier: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const normalized = normalizeIdentifier(identifier);

    const credential = await this.db.credential.findUnique({
      where: { identifier: normalized },
      include: {
        user: {
          include: { memberships: true },
        },
      },
    });

    if (!credential) {
      // Audit generic failure - no identifier recorded
      await this.db.auditEvent.create({
        data: {
          actorUserId: null,
          entityType: 'AuthEvent',
          entityId: 'unknown',
          action: 'LOCAL_LOGIN_FAILURE',
        },
      }).catch(() => { /* audit is non-critical */ });
      return null;
    }

    if (credential.user.status === UserStatus.DISABLED) {
      this.logger.warn(`Deaktivierter User ${credential.user.id} versuchte lokale Anmeldung`);
      await this.db.auditEvent.create({
        data: {
          actorUserId: credential.user.id,
          entityType: 'AuthEvent',
          entityId: credential.user.id,
          action: 'LOCAL_LOGIN_FAILURE',
        },
      }).catch(() => { /* audit is non-critical */ });
      return null;
    }

    const valid = await this.passwordHashing.verify(password, credential.passwordHash);
    if (!valid) {
      // Audit generic failure - no identifier recorded
      await this.db.auditEvent.create({
        data: {
          actorUserId: null,
          entityType: 'AuthEvent',
          entityId: 'unknown',
          action: 'LOCAL_LOGIN_FAILURE',
        },
      }).catch(() => { /* audit is non-critical */ });
      return null;
    }

    // Audit successful login
    await this.db.auditEvent.create({
      data: {
        actorUserId: credential.user.id,
        entityType: 'AuthEvent',
        entityId: credential.user.id,
        action: 'LOCAL_LOGIN_SUCCESS',
      },
    }).catch(() => { /* audit is non-critical */ });

    return {
      id: credential.user.id,
      email: credential.user.email,
      displayName: credential.user.displayName,
      status: credential.user.status,
      memberships: credential.user.memberships.map((m) => ({
        householdId: m.householdId,
        role: m.role,
      })),
    };
  }

  /**
   * Find a credential by identifier (normalized).
   * Used for admin/management purposes.
   */
  async findCredentialByIdentifier(
    identifier: string,
  ): Promise<{ userId: string; identifier: string } | null> {
    const normalized = normalizeIdentifier(identifier);
    const credential = await this.db.credential.findUnique({
      where: { identifier: normalized },
      select: { userId: true, identifier: true },
    });
    return credential;
  }
}
