import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import {
  GlobalRole,
  InsurancePolicyType,
  ObjectSharePermission,
  ObjectShareScopeType,
  UserStatus,
} from '@prisma/client';
import { PasswordHashingService } from './password-hashing.service';

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
 * Validierung eines Benutzernamens (nach Normalisierung).
 * Erlaubt sind 3-32 Zeichen aus [a-z0-9._-], beginnend mit Buchstabe/Ziffer.
 * ASCII-only: vermeidet Homoglyphen-/Umlaut-Probleme bei Login-Identifiers.
 */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/**
 * Passwortrichtlinie: mindestens 12 Zeichen, hoechstens 128 Zeichen.
 * Keine weiteren Komplexitaetsregeln (Laenge ist der wirksamste Faktor).
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
   * Findet einen User ueber seine gebundene OIDC-Identitaet (ADR-007).
   * OIDC provisioniert keine Konten: Ohne (oder bei gesperrtem) Konto
   * wird null zurueckgegeben, damit der OIDC-Login generisch fehlschlaegt.
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
      this.logger.warn(`OIDC-Login fuer ungebundene Identitaet abgelehnt (issuer=${oidcIssuer})`);
      return null;
    }
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`OIDC-Login fuer nicht aktives Konto ${user.id} abgelehnt`);
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  /**
   * Registriert ein neues lokales Konto. Das Konto wird mit dem Status
   * PENDING_APPROVAL angelegt und ist bis zur Freischaltung durch einen
   * Admin gesperrt (weder lokaler noch OIDC-Login moeglich).
   *
   * Wirft ConflictException, wenn der Benutzername bereits vergeben ist.
   * Passwortwerte werden niemals gespeichert, geloggt oder auditiert.
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
        throw new ConflictException('Benutzername ist bereits vergeben');
      }
      throw error;
    }
  }

  /**
   * Versucht die lokale Anmeldung mit Benutzername und Passwort.
   *
   * Liefert bei Erfolg den authentifizierten User, sonst null (generisch –
   * ohne Hinweis, ob der Benutzername existiert, das Passwort falsch war
   * oder das Konto gesperrt/freizuschaltend ist).
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

    // Generischer Fehlerpfad: weder Benutzerexistenz noch Status verraten.
    if (!user || user.status !== UserStatus.ACTIVE || !user.credential) {
      if (user && user.status !== UserStatus.ACTIVE) {
        this.logger.warn(
          `Anmeldung fuer nicht aktives Konto ${user.id} abgelehnt (Status ${user.status})`,
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
   * Prueft, ob ein User eine Policy lesen darf.
   *
   * - Jeder Zugriff erfordert die Household-Mitgliedschaft (Isolation).
   * - USER/ADMIN duerfen alle Policies ihres Households lesen (bestehender
   *   Berechtigungsrahmen bleibt erhalten).
   * - READ_ONLY darf ausschliesslich explizit freigegebene Policies lesen
   *   (INSURANCE-/CATEGORY-/ALL_OWNED-Freigabe mit permission READ) – auch
   *   eigene historische Daten sind ohne Freigabe nicht sichtbar (AP-16).
   */
  async assertPolicyReadAccess(
    user: AuthenticatedUser,
    householdId: string,
    policyId: string,
  ): Promise<void> {
    const membership = await this.getMembership(user.id, householdId);
    if (!membership) {
      throw new ForbiddenException('Isolation: kein Zugriff auf fremdes Household');
    }

    const policy = await this.db.insurancePolicy.findFirst({
      where: { id: policyId, householdId },
      select: { id: true },
    });
    if (!policy) {
      throw new NotFoundException('Versicherung nicht gefunden');
    }

    if (user.role === GlobalRole.READ_ONLY) {
      const readable = await this.hasPolicyReadShare(householdId, user.id, policyId);
      if (!readable) {
        throw new ForbiddenException('Keine Lese-Freigabe fuer diese Versicherung');
      }
    }
  }

  /**
   * Liefert die fuer den User lesbaren Policy-IDs eines Households.
   * Returns null fuer USER/ADMIN (alle Policies des Households).
   * Fuer READ_ONLY werden nur die explizit mit READ freigegebenen Policies
   * zurueckgegeben.
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
