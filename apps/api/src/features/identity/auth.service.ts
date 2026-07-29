import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@insura/foundation';
import { HouseholdRole, UserStatus } from '@prisma/client';

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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly db: DatabaseService) {}

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
}
