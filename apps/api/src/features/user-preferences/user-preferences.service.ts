import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@insura/foundation';
import type { UserPreferenceResponseDto } from './dto/user-preferences.dto';

/**
 * Key of the UI accent colour preference stored by the design system.
 */
const ACCENT_COLOUR_KEY = 'ui:accentColour';

/**
 * Manages user-scoped key-value preferences.
 *
 * Preferences are scoped to the authenticated user and are not shared
 * across users or households. Keys are unique per user.
 */
@Injectable()
export class UserPreferencesService {
  private readonly logger = new Logger(UserPreferencesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Validates a preference value for known UI keys.
   * The accent colour must be a valid 3- or 6-digit hex string
   * to prevent arbitrary content from being persisted and rendered.
   */
  private validateValue(key: string, value: string): void {
    if (key === ACCENT_COLOUR_KEY) {
      const cleaned = value.trim().replace(/^#/, '');
      if (!/^[0-9a-fA-F]{3}$/.test(cleaned) && !/^[0-9a-fA-F]{6}$/.test(cleaned)) {
        throw new BadRequestException(
          `Value for '${key}' must be a valid 3- or 6-digit hex colour string`,
        );
      }
    }
  }

  /**
   * Retrieves a single preference for the given user.
   * Throws NotFoundException if the key does not exist.
   */
  async getPreference(userId: string, key: string): Promise<UserPreferenceResponseDto> {
    const pref = await this.db.userPreference.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!pref) {
      throw new NotFoundException(`Preference '${key}' not found for user`);
    }

    return {
      key: pref.key,
      value: pref.value,
      createdAt: pref.createdAt.toISOString(),
      updatedAt: pref.updatedAt.toISOString(),
    };
  }

  /**
   * Sets (creates or updates) a preference for the given user.
   * Throws BadRequestException for invalid values of known keys.
   */
  async setPreference(userId: string, key: string, value: string): Promise<UserPreferenceResponseDto> {
    this.validateValue(key, value);

    const pref = await this.db.userPreference.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
    });

    this.logger.log(`Preference '${key}' set for user ${userId}`);

    return {
      key: pref.key,
      value: pref.value,
      createdAt: pref.createdAt.toISOString(),
      updatedAt: pref.updatedAt.toISOString(),
    };
  }

  /**
   * Lists all preferences for the given user.
   */
  async listPreferences(userId: string): Promise<UserPreferenceResponseDto[]> {
    const prefs = await this.db.userPreference.findMany({
      where: { userId },
      orderBy: { key: 'asc' },
    });

    return prefs.map((p) => ({
      key: p.key,
      value: p.value,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }
}
