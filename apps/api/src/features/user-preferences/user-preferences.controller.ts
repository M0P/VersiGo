import {
  Controller,
  Get,
  Put,
  Param,
  Body,
} from '@nestjs/common';
import { UserPreferencesService } from './user-preferences.service';
import { CurrentUser } from '../identity/current-user.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { SetUserPreferenceDto, UserPreferenceResponseDto } from './dto/user-preferences.dto';

/**
 * Controller for user-scoped preferences.
 *
 * All endpoints require authentication (handled by the global SessionAuthGuard).
 * Data is scoped to the authenticated user – one user cannot read or write
 * another user's preferences.
 *
 * Route prefix: /user/preferences
 */
@Controller('user/preferences')
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
