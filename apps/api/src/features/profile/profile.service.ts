import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

/**
 * Persoenliches Profil (AP-17).
 *
 * USER und ADMIN aendern ausschliesslich EIGENE Profilwerte (Anzeigename,
 * Locale). Aenderungen sind auf den aktuellen Nutzer begrenzt und koennen
 * weder Household- noch Systemkonfiguration ueberschreiben. Sensible
 * Zugangsdaten, Rollen, Freigaben oder Systemwerte sind hier nicht
 * editierbar. READ_ONLY wird bereits durch den Controller-RoleGuard
 * (Rollen-Hierarchie) ausgeschlossen.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Liefert das eigene Profil des angemeldeten Nutzers. */
  async getProfile(userId: string): Promise<ProfileResponseDto> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Profil nicht gefunden');
    }
    return this.toProfile(user);
  }

  /**
   * Aendert ausschliesslich die uebergebenen Profilfelder des aktuellen
   * Nutzers. Der Username ist unveraenderbar (Anmelde-Identifier).
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileResponseDto> {
    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new NotFoundException('Profil nicht gefunden');
    }

    const data: { displayName?: string; locale?: string } = {};
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName.trim();
    }
    if (dto.locale !== undefined) {
      data.locale = dto.locale;
    }

    if (Object.keys(data).length === 0) {
      // Nichts zu aendern – kein Schreibzugriff, kein Audit.
      return this.toProfile(existing);
    }

    const user = await this.db.user.update({ where: { id: userId }, data });

    // Audit nur mit Feldnamen (keine Werte) – datenschutzfreundlich und
    // ohne Klartext-PII in der revisionssicheren Historie.
    await this.audit(userId, Object.keys(data));

    this.logger.log(`Profil von User ${userId} aktualisiert: ${Object.keys(data).join(', ')}`);
    return this.toProfile(user);
  }

  private toProfile(user: {
    id: string;
    username: string;
    displayName: string;
    locale: string;
    role: string;
    createdAt: Date;
  }): ProfileResponseDto {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      locale: user.locale,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async audit(userId: string, changedFields: string[]): Promise<void> {
    if (changedFields.length === 0) return;
    try {
      await this.db.auditEvent.create({
        data: {
          actorUserId: userId,
          entityType: 'User',
          entityId: userId,
          action: 'PROFILE_UPDATED',
          diffJson: { fields: changedFields } as never,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit-Eintrag fehlgeschlagen: ${(error as Error).message}`);
    }
  }
}
