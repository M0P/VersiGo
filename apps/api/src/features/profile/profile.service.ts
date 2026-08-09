import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

/**
 * Personal profile (AP-17).
 *
 * USER and ADMIN change exclusively THEIR OWN profile values (display
 * name, locale). Changes are limited to the current user and cannot
 * overwrite household or system configuration. Sensible credentials,
 * roles, shares or system values are not editable here. READ_ONLY is
 * already blocked by the controller RoleGuard (role hierarchy).
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Returns the own profile of the signed-in user. */
  async getProfile(userId: string): Promise<ProfileResponseDto> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Profile not found');
    }
    return this.toProfile(user);
  }

  /**
   * Changes exclusively the passed profile fields of the current user.
   * The username is immutable (login identifier).
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileResponseDto> {
    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new NotFoundException('Profile not found');
    }

    const data: { displayName?: string; locale?: string } = {};
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName.trim();
    }
    if (dto.locale !== undefined) {
      data.locale = dto.locale;
    }

    if (Object.keys(data).length === 0) {
      // Nothing to change - no write access, no audit.
      return this.toProfile(existing);
    }

    const user = await this.db.user.update({ where: { id: userId }, data });

    // Audit with field names only (no values) - privacy-friendly and
    // without plain-text PII in the auditable history.
    await this.audit(userId, Object.keys(data));

    this.logger.log(`Profile of user ${userId} updated: ${Object.keys(data).join(', ')}`);
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
      this.logger.warn(`Audit entry failed: ${(error as Error).message}`);
    }
  }
}
