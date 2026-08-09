import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { CurrentUser } from '../identity/current-user.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { LanguageService, type LanguageSessionData } from './language.service';
import { SetLanguageDto, type LanguagePreferenceDto } from './dto/language.dto';

interface LanguageRequest {
  session?: LanguageSessionData | null;
  headers?: { 'accept-language'?: string };
}

/**
 * AP-21: language preference endpoint for ALL authenticated roles
 * (READ_ONLY included).
 *
 * Security model:
 * - READ_ONLY may only read/change its own language (session-bound,
 *   never persisted, no access to other profile settings, household
 *   data, user administration or system settings).
 * - USER/ADMIN use the same account-specific setting.
 * - There is no system-wide language and no translation management.
 */
@Controller('user/language')
@Roles(GlobalRole.READ_ONLY)
export class LanguageController {
  constructor(private readonly language: LanguageService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: LanguageRequest,
  ): Promise<LanguagePreferenceDto> {
    return this.language.resolveLanguage(
      user,
      request.session,
      request.headers?.['accept-language'],
    );
  }

  @Put()
  async set(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: LanguageRequest,
    @Body() dto: SetLanguageDto,
  ): Promise<LanguagePreferenceDto> {
    return this.language.setLanguage(user, request.session, dto.language);
  }
}
