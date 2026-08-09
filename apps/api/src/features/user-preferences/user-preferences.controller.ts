import {
  Controller,
  Get,
  Put,
  Param,
  Body,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { UserPreferencesService } from './user-preferences.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { SetUserPreferenceDto, UserPreferenceResponseDto } from './dto/user-preferences.dto';

/**
 * Controller for user-scoped preferences.
 *
 * All endpoints require authentication (handled by the global SessionAuthGuard).
 * Data is scoped to the authenticated user – one user cannot read or write
 * another user's preferences.
 *
 * AP-17 (permission matrix): personal profile/preference values are only
 * for USER and ADMIN. READ_ONLY receives nothing via direct requests
 * (RolesGuard, role hierarchy ADMIN > USER > READ_ONLY).
 *
 * Route prefix: /user/preferences
 */
@Controller('user/preferences')
@Roles(GlobalRole.USER)
export class UserPreferencesController {
  constructor(private readonly preferences: UserPreferencesService) {}

  /**
   * List all preferences for the current user.
   * GET /user/preferences
   */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserPreferenceResponseDto[]> {
    return this.preferences.listPreferences(user.id);
  }

  /**
   * Get a single preference by key.
   * GET /user/preferences/:key
   */
  @Get(':key')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ): Promise<UserPreferenceResponseDto> {
    return this.preferences.getPreference(user.id, key);
  }

  /**
   * Set (create or update) a preference by key.
   * PUT /user/preferences/:key
   */
  @Put(':key')
  async set(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: SetUserPreferenceDto,
  ): Promise<UserPreferenceResponseDto> {
    return this.preferences.setPreference(user.id, key, dto.value);
  }
}
