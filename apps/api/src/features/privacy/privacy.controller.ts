import { Controller, Delete, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from '../identity/roles.decorator';
import { CurrentUser } from '../identity/current-user.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import { PrivacyService, PrivacyExport } from './privacy.service';

/**
 * Privacy/GDPR-API (AP-19).
 *
 * Berechtigungsgrenze: NUR USER und ADMIN (Rollenhierarchie) – READ_ONLY
 * erhaelt 403 (konsistent zu Profil/Praeferenzen, ADR-007). Die Identitaet
 * kommt ausschliesslich aus der Session (`@CurrentUser`), nie aus
 * Pfad-/Query-Parametern -> kein IDOR.
 *
 * - `GET /privacy/export`  – Export der eigenen personenbezogenen Daten
 * - `DELETE /privacy/account` – Loeschung des eigenen Kontos inkl. Daten
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
