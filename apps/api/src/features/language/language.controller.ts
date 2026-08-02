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
 * AP-21: Sprachpraeferenz-Endpunkt fuer ALLE authentifizierten Rollen
 * (READ_ONLY eingeschlossen).
 *
 * Sicherheitsmodell:
 * - READ_ONLY darf ausschliesslich seine eigene Sprache lesen/aendern
 *   (sitzungsbezogen, niemals persistiert, kein Zugriff auf andere
 *   Profileinstellungen, Haushaltsdaten, Nutzerverwaltung oder
 *   Systemeinstellungen).
 * - USER/ADMIN nutzen dieselbe, kontospezifische Einstellung.
 * - Es gibt keine systemweite Sprache und keine Uebersetzungsverwaltung.
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
