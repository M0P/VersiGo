import { Body, Controller, Get, Patch } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { ProfileService } from './profile.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

/**
 * Personal profile (AP-17).
 *
 * Permission boundary: only USER and ADMIN (role hierarchy) - READ_ONLY
 * receives neither profile values nor change capabilities via direct requests.
 *
 * Route prefix: /user/profile
 */
@Controller('user/profile')
@Roles(GlobalRole.USER)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** Read the own profile. */
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponseDto> {
    return this.profile.getProfile(user.id);
  }

  /** Change the own profile (only personal fields). */
  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profile.updateProfile(user.id, dto);
  }
}
