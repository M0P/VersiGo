import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OidcStrategy } from './oidc.strategy';
import { SessionAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { HouseholdMembershipGuard } from './household-membership.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OidcStrategy,
    HouseholdMembershipGuard,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, HouseholdMembershipGuard],
})
export class IdentityModule {}
