import { Controller, Delete, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { CurrentUser } from '../identity/current-user.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { PrivacyService, PrivacyExport } from './privacy.service';

/**
 * Privacy/GDPR-API (AP-19).
 *
 * Permission boundary: only USER and ADMIN (role hierarchy) - READ_ONLY
 * gets 403 (consistent with profile/preferences, ADR-007). The identity
 * comes exclusively from the session (`@CurrentUser`), never from
 * path/query parameters -> no IDOR.
 *
 * - `GET /privacy/export` - export of one's own personal data
 * - `DELETE /privacy/account` – deletion of one's own account incl. data
 */
@Controller('privacy')
@Roles(GlobalRole.USER)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrivacyExport> {
    return this.privacy.exportPersonalData(user.id);
  }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.privacy.deleteAccount(user);
  }
}
