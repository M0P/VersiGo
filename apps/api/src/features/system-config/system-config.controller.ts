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
 * Admin-UI endpoints for the central system configuration (AP-17).
 *
 * Permission boundary (independent of visible navigation entries):
 * only global ADMINS may read or change system settings. `USER`/
 * `READ_ONLY` receive no values via direct requests, no secrets,
 * metadata or change capabilities (global RolesGuard).
 *
 * Route prefix: /admin/system-config
 */
@Controller('admin/system-config')
@Roles(GlobalRole.ADMIN)
export class SystemConfigController {
  constructor(private readonly systemConfig: SystemConfigService) {}

  /** Complete catalog view with effective values, sources and errors. */
  @Get()
  async list(): Promise<SystemConfigEntryDto[]> {
    return this.systemConfig.list();
  }

  /** Single key. */
  @Get(':key')
  async get(@Param('key') key: string): Promise<SystemConfigEntryDto> {
    return this.systemConfig.get(key);
  }

  /** Sets/changes a UI value (atomically validated, secrets encrypted). */
  @Put(':key')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
  ): Promise<SystemConfigEntryDto> {
    return this.systemConfig.update(key, dto.value, user);
  }

  /** Resets the UI value (effective value falls back to .env/default). */
  @Delete(':key')
  async reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ): Promise<SystemConfigEntryDto> {
    return this.systemConfig.reset(key, user);
  }

  /** Safe connectivity check (only for keys marked as testable). */
  @Post(':key/test')
  async test(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ): Promise<ConnectivityTestResultDto> {
    return this.systemConfig.testConnectivity(key, user);
  }
}
