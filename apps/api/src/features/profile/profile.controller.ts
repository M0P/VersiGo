import { Body, Controller, Get, Patch } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { ProfileService } from './profile.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

/**
 * Persoenliches Profil (AP-17).
 *
 * Berechtigungsgrenze: NUR USER und ADMIN (Rollenhierarchie) – READ_ONLY
 * erhaelt ueber direkte Anfragen weder Profilwerte noch Aenderungsmoeglichkeiten.
 *
 * Route-Prefix: /user/profile
 */
@Controller('user/profile')
@Roles(GlobalRole.USER)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** Eigenes Profil lesen. */
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponseDto> {
    return this.profile.getProfile(user.id);
  }

  /** Eigenes Profil aendern (nur persoenliche Felder). */
  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profile.updateProfile(user.id, dto);
  }
}
