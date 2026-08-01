import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DatabaseService } from '@insura/foundation';
import { GlobalRole, Prisma, UserStatus } from '@prisma/client';
import { AuthenticatedUser } from './auth.service';
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
 * Admin-Verwaltung lokaler Konten (ADRs 005-007):
 * - Freischaltung (approve) und Ablehnung (reject) von Neuregistrierungen
 * - Sperren (disable) und Entsperren (enable) von Konten
 * - Setzen der globalen Rolle (GlobalRole)
 * - Binden/Entbinden einer OIDC-Identitaet an ein lokales Konto
 *
 * Schutzregeln:
 * - Letzter-Admin-Schutz: Der letzte aktive ADMIN kann weder gesperrt noch
 *   herabgestuft werden (serialisierbare Transaktion).
 * - Jede Aenderung wird im Audit-Event-Log protokolliert.
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
   * Schaltet ein Konto mit Status PENDING_APPROVAL frei (ACTIVE).
   */
  async approve(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw new NotFoundException('Benutzer nicht gefunden');
      if (user.status !== UserStatus.PENDING_APPROVAL) {
        throw new ConflictException('Nur freizuschaltende Konten (PENDING_APPROVAL) koennen freigeschaltet werden');
      }

      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      await this.audit(tx, admin, userId, 'USER_APPROVED', { status: 'ACTIVE' });
    });
  }

  /**
   * Lehnt ein Konto mit Status PENDING_APPROVAL ab (DISABLED).
   */
  async reject(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw new NotFoundException('Benutzer nicht gefunden');
      if (user.status !== UserStatus.PENDING_APPROVAL) {
        throw new ConflictException('Nur freizuschaltende Konten (PENDING_APPROVAL) koennen abgelehnt werden');
      }

      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.DISABLED } });
      await this.audit(tx, admin, userId, 'USER_REJECTED', { status: 'DISABLED' });
    });
  }

/**
 * Fuehrt einen Callback in einer serialisierbaren Transaktion aus und
 * uebersetzt Prisma-Fehler P2034 (Serialisierungskonflikt / Deadlock) in
 * eine ConflictException. Da die Letzter-Admin-Pruefung race-sensitiv ist,
 * wird der Vorgang bei P2034 begrenzt wiederholt, bevor ein 409 gemeldet
 * wird (statt eines unbehandelten 500).
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
        // Serialisierungs-Konflikt: erneut versuchen
        lastError = error;
        continue;
      }
      if (code === 'P2034') {
        throw new ConflictException(
          'Gleichzeitige Aenderung erkannt. Bitte erneut versuchen.',
        );
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Sperrt ein aktives Konto (DISABLED). Der letzte aktive ADMIN kann nicht
 * gesperrt werden (Letzter-Admin-Schutz).
 */
async disable(admin: AuthenticatedUser, userId: string): Promise<void> {
  if (admin.id === userId) {
    throw new ConflictException('Sie koennen sich nicht selbst sperren');
  }

  await this.runSerializable(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true },
    });
    if (!user) throw new NotFoundException('Benutzer nicht gefunden');
    if (user.status !== UserStatus.ACTIVE) {
      throw new ConflictException('Nur aktive Konten koennen gesperrt werden');
    }

    await this.assertNotLastActiveAdmin(tx, user.role);
    await tx.user.update({ where: { id: userId }, data: { status: UserStatus.DISABLED } });
    await this.audit(tx, admin, userId, 'USER_DISABLED', { status: 'DISABLED' });
  });
}

  /**
   * Entsperrt ein gesperrtes Konto (ACTIVE).
   */
  async enable(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw new NotFoundException('Benutzer nicht gefunden');
      if (user.status !== UserStatus.DISABLED) {
        throw new ConflictException('Nur gesperrte Konten koennen entsperrt werden');
      }

      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      await this.audit(tx, admin, userId, 'USER_ENABLED', { status: 'ACTIVE' });
    });
  }

  /**
   * Setzt die globale Rolle eines Users. Beim Herabstufen des letzten
   * aktiven ADMIN gilt der Letzter-Admin-Schutz.
   */
  async setRole(admin: AuthenticatedUser, userId: string, role: GlobalRole): Promise<void> {
    await this.runSerializable(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, role: true },
      });
      if (!user) throw new NotFoundException('Benutzer nicht gefunden');
      if (user.role === role) {
        throw new ConflictException('Rolle ist bereits gesetzt');
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
   * Bindet eine OIDC-Identitaet (issuer, subject) an ein lokales Konto.
   * Die UNIQUE-Constraint (oidcIssuer, oidcSubject) verhindert, dass
   * dieselbe Identitaet an zwei Konten gebunden wird.
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
        if (!user) throw new NotFoundException('Benutzer nicht gefunden');

        // Trailing-Slash-Varianz normalisieren, damit die gespeicherte
        // Bindung unabhaengig von einem abschliessenden Slash beim Login
        // (claims.iss, ebenfalls normalisiert) wiederfindbar ist (ADR-007).
        await tx.user.update({
          where: { id: userId },
          data: { oidcIssuer: normalizeIssuerUrl(oidcIssuer), oidcSubject },
        });
        await this.audit(tx, admin, userId, 'OIDC_BOUND', { oidcIssuer });
      });
    } catch (error) {
      // P2002: (oidcIssuer, oidcSubject) ist bereits an ein anderes Konto gebunden
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Diese OIDC-Identitaet ist bereits an ein anderes Konto gebunden');
      }
      throw error;
    }
  }

  /**
   * Loest die OIDC-Bindung eines Kontos (nur die Bindung, nie das Konto).
   */
  async unbindOidcIdentity(admin: AuthenticatedUser, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { oidcIssuer: true },
      });
      if (!user) throw new NotFoundException('Benutzer nicht gefunden');
      if (!user.oidcIssuer) {
        throw new ConflictException('Konto hat keine OIDC-Bindung');
      }

      await tx.user.update({ where: { id: userId }, data: { oidcIssuer: null, oidcSubject: null } });
      await this.audit(tx, admin, userId, 'OIDC_UNBOUND', {});
    });
  }

  /**
   * Letzter-Admin-Schutz: Wirft ConflictException, wenn der Ziel-User der
   * letzte verbleibende aktive ADMIN ist (nur relevant bei aktiven ADMINs).
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
      throw new ConflictException('Der letzte aktive Administrator kann nicht geaendert werden');
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
      this.logger.warn(`Audit-Eintrag fehlgeschlagen: ${(error as Error).message}`);
    }
  }
}
