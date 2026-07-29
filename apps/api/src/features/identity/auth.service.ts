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

type MembershipRecord = {
  householdId: string;
  role: HouseholdRole;
};

type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  memberships: MembershipRecord[];
};

type HouseholdMembershipRecord = {
  householdId: string;
  userId: string;
  role: HouseholdRole;
};

type IdentityDbShape = {
  user?: {
    upsert: (args: unknown) => Promise<UserRecord>;
    findUnique: (args: unknown) => Promise<UserRecord | null>;
  };
  householdMembership?: {
    findUnique: (args: unknown) => Promise<HouseholdMembershipRecord | null>;
  };
  client?: {
    user?: {
      upsert: (args: unknown) => Promise<UserRecord>;
      findUnique: (args: unknown) => Promise<UserRecord | null>;
    };
    householdMembership?: {
      findUnique: (args: unknown) => Promise<HouseholdMembershipRecord | null>;
    };
  };
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly dbShape: IdentityDbShape;

  constructor(private readonly db: DatabaseService) {
    this.dbShape = this.db as unknown as IdentityDbShape;
  }

  private get userRepo() {
    const repo = this.dbShape.user ?? this.dbShape.client?.user;
    if (!repo) {
      throw new Error('Identity user repository nicht verfügbar');
    }
    return repo;
  }

  private get membershipRepo() {
    const repo = this.dbShape.householdMembership ?? this.dbShape.client?.householdMembership;
    if (!repo) {
      throw new Error('Identity householdMembership repository nicht verfügbar');
    }
    return repo;
  }

  async upsertFromOidcClaims(input: OidcClaimsInput): Promise<AuthenticatedUser> {
    const user = await this.userRepo.upsert({
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
      memberships: user.memberships.map((m: MembershipRecord) => ({
        householdId: m.householdId,
        role: m.role,
      })),
    };
  }

  async getMembership(userId: string, householdId: string): Promise<HouseholdMembershipRecord | null> {
    return this.membershipRepo.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
  }

  async findById(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.userRepo.findUnique({
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
      memberships: user.memberships.map((m: MembershipRecord) => ({
        householdId: m.householdId,
        role: m.role,
      })),
    };
  }
}
