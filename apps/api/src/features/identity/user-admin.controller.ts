import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { Roles } from './roles.decorator';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser } from './auth.service';
import { UserAdminService, AdminUserListItem } from './user-admin.service';
import { BindOidcIdentityDto, ListUsersQueryDto, SetUserRoleDto } from './user-admin.dto';

/**
 * Admin-Verwaltung lokaler Konten (AP-16). Nur fuer globale ADMINs.
 * Alle Aktionen protokollieren einen Audit-Eintrag und schuetzen den
 * letzten aktiven ADMIN vor Sperrung/Herabstufung.
 */
@Controller('admin/users')
@Roles(GlobalRole.ADMIN)
export class UserAdminController {
  constructor(private readonly userAdmin: UserAdminService) {}

  @Get()
  async list(
    @Query() query: ListUsersQueryDto,
  ): Promise<{ users: AdminUserListItem[]; total: number }> {
    return this.userAdmin.list(query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(@CurrentUser() admin: AuthenticatedUser, @Param('id') userId: string): Promise<void> {
    await this.userAdmin.approve(admin, userId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(@CurrentUser() admin: AuthenticatedUser, @Param('id') userId: string): Promise<void> {
    await this.userAdmin.reject(admin, userId);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@CurrentUser() admin: AuthenticatedUser, @Param('id') userId: string): Promise<void> {
    await this.userAdmin.disable(admin, userId);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enable(@CurrentUser() admin: AuthenticatedUser, @Param('id') userId: string): Promise<void> {
    await this.userAdmin.enable(admin, userId);
  }

  @Post(':id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRole(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') userId: string,
    @Body() body: SetUserRoleDto,
  ): Promise<void> {
    await this.userAdmin.setRole(admin, userId, body.role);
  }

  @Post(':id/oidc-binding')
  @HttpCode(HttpStatus.NO_CONTENT)
  async bindOidc(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') userId: string,
    @Body() body: BindOidcIdentityDto,
  ): Promise<void> {
    await this.userAdmin.bindOidcIdentity(admin, userId, body.oidcIssuer, body.oidcSubject);
  }

  @Post(':id/oidc-binding/unbind')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unbindOidc(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') userId: string,
  ): Promise<void> {
    await this.userAdmin.unbindOidcIdentity(admin, userId);
  }
}
