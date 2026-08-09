import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@versigo/foundation';
import type { UserPreferenceResponseDto } from './dto/user-preferences.dto';

/**
 * Versioned catalog of personal UI preferences (AP-17).
 *
 * The concrete list is an allowlist – NOT an unvalidated JSON collection
 * field. Only catalogued keys may be read or set; unknown keys are
 * strictly rejected. Every key has a fixed value type with its own
 * validation.
 */
export const USER_PREFERENCES_VERSION = 1;

export type UserPreferenceValueType = 'hexColour' | 'themeMode';

export interface UserPreferenceDefinition {
  type: UserPreferenceValueType;
  description: string;
}

export const USER_PREFERENCE_CATALOG: Readonly<Record<string, UserPreferenceDefinition>> = {
  'ui:accentColour': {
    type: 'hexColour',
    description: 'Accent colour of the design system (3- or 6-digit hex).',
  },
  'theme': {
    type: 'themeMode',
    description: 'Display mode: light, dark or system.',
  },
} as const;

const THEME_MODES = ['light', 'dark', 'system'] as const;

/**
 * Manages user-scoped key-value preferences.
 *
 * Preferences are scoped to the authenticated user and are not shared
 * across users or households. Keys are unique per user and restricted
 * to the versioned catalog above.
 */
@Injectable()
export class UserPreferencesService {
  private readonly logger = new Logger(UserPreferencesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Validates a preference key (allowlist) and its value against the
   * catalog. Throws BadRequestException for unknown keys or invalid values.
   */
  private validate(key: string, value: string): void {
    const definition = USER_PREFERENCE_CATALOG[key];
    if (!definition) {
      throw new BadRequestException(
        `Unknown preference key '${key}' – not in the catalog (allowlist).`,
      );
    }

    switch (definition.type) {
      case 'hexColour': {
        const cleaned = value.trim().replace(/^#/, '');
        if (!/^[0-9a-fA-F]{3}$/.test(cleaned) && !/^[0-9a-fA-F]{6}$/.test(cleaned)) {
          throw new BadRequestException(
            `Value for '${key}' must be a valid 3- or 6-digit hex colour string`,
          );
        }
        break;
      }
      case 'themeMode': {
        if (!THEME_MODES.includes(value as (typeof THEME_MODES)[number])) {
          throw new BadRequestException(
            `Value for '${key}' must be one of: ${THEME_MODES.join(', ')}`,
          );
        }
        break;
      }
    }
  }

  /**
   * Retrieves a single preference for the given user.
   * Throws NotFoundException if the key does not exist.
   */
  async getPreference(userId: string, key: string): Promise<UserPreferenceResponseDto> {
    const definition = USER_PREFERENCE_CATALOG[key];
    if (!definition) {
      throw new BadRequestException(
        `Unknown preference key '${key}' – not in the catalog (allowlist).`,
      );
    }

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
   * Throws BadRequestException for unknown keys or invalid values.
   */
  async setPreference(userId: string, key: string, value: string): Promise<UserPreferenceResponseDto> {
    this.validate(key, value);

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
