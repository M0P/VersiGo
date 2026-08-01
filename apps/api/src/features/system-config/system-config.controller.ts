import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { SystemConfigService } from './system-config.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import {
  UpdateSystemConfigDto,
  SystemConfigEntryDto,
  ConnectivityTestResultDto,
} from './dto/system-config.dto';

/**
 * Admin-UI-Endpunkte fuer die zentrale Systemkonfiguration (AP-17).
 *
 * Berechtigungsgrenze (unabhaengig von sichtbaren Navigationspunkten):
 * NUR globale ADMINS duerfen Systemeinstellungen lesen oder aendern.
 * `USER`/`READ_ONLY` erhalten ueber direkte Anfragen keinerlei Werte,
 * Secrets, Metadaten oder Aenderungsmoeglichkeiten (RolesGuard global).
 *
 * Route-Prefix: /admin/system-config
 */
@Controller('admin/system-config')
@Roles(GlobalRole.ADMIN)
export class SystemConfigController {
  constructor(private readonly systemConfig: SystemConfigService) {}

  /** Vollstaendige Katalogansicht mit effektiven Werten, Quellen und Fehlern. */
  @Get()
  async list(): Promise<SystemConfigEntryDto[]> {
    return this.systemConfig.list();
  }

  /** Einzelner Schluessel. */
  @Get(':key')
  async get(@Param('key') key: string): Promise<SystemConfigEntryDto> {
    return this.systemConfig.get(key);
  }

  /** Setzt/aendert einen UI-Wert (atomar validiert, Secrets verschluesselt). */
  @Put(':key')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
  ): Promise<SystemConfigEntryDto> {
    return this.systemConfig.update(key, dto.value, user);
  }

  /** Setzt den UI-Wert zurueck (effektiver Wert faellt auf .env/Default). */
  @Delete(':key')
  async reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ): Promise<SystemConfigEntryDto> {
    return this.systemConfig.reset(key, user);
  }

  /** Sichere Connectivity-Pruefung (nur fuer als pruefbar markierte Schluessel). */
  @Post(':key/test')
  async test(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ): Promise<ConnectivityTestResultDto> {
    return this.systemConfig.testConnectivity(key, user);
  }
}
