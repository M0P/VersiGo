import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigService, CapabilityFlagsService, type AppConfig } from '@versigo/foundation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OidcStrategy } from './oidc.strategy';
import { SessionAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { HouseholdMembershipGuard } from './household-membership.guard';
import { PasswordHashingService } from './password-hashing.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { LocalAdminBootstrapService } from './local-admin.bootstrap';
import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';

@Global()
@Module({
  controllers: [AuthController, UserAdminController],
  providers: [
    AuthService,
    OidcStrategy,
    PasswordHashingService,
    LoginRateLimiterService,
    HouseholdMembershipGuard,
    LocalAdminBootstrapService,
    UserAdminService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, HouseholdMembershipGuard, UserAdminService],
})
export class IdentityModule implements OnModuleInit {
  private readonly logger = new Logger(IdentityModule.name);

  constructor(
    private readonly capabilities: CapabilityFlagsService,
    private readonly config: AppConfigService,
    private readonly adminBootstrap: LocalAdminBootstrapService,
  ) {}

  async onModuleInit(): Promise<void> {
    // BugFix-05: capability resolution has run asynchronously since the
    // resolver migration (UI > ENV > DEFAULT). If the database is not
    // reachable at boot (Prisma connection is lazy, $connect() does not
    // check), the identity configuration falls back to the environment
    // snapshot (behavior before BugFix-05): the API still starts despite a
    // DB outage and the health endpoint reports db: down instead of
    // preventing the boot.
    let oidcEnabled: boolean;
    let localEnabled: boolean;
    try {
      [oidcEnabled, localEnabled] = await Promise.all([
        this.capabilities.isEnabled('oidc'),
        this.capabilities.isEnabled('local'),
      ]);
    } catch (error) {
      this.logger.warn(
        'Capability resolution at boot failed (DB unreachable?) – ' +
          'fallback to environment configuration: ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      oidcEnabled = Boolean(this.config.get('OIDC_ENABLED' as keyof AppConfig));
      localEnabled = Boolean(this.config.get('LOCAL_AUTH_ENABLED' as keyof AppConfig));
    }

    if (!oidcEnabled && !localEnabled) {
      this.logger.error(
        'KEINE AUTHENTIFIZIERUNGSMETHODE KONFIGURIERT. ' +
        'Setze mindestens eine der folgenden Umgebungsvariablen: ' +
        'OIDC_ENABLED=true oder LOCAL_AUTH_ENABLED=true. ' +
        'The application will not start without authentication.',
      );
      throw new Error(
        'No authentication method configured. Set OIDC_ENABLED=true or LOCAL_AUTH_ENABLED=true.',
      );
    }

    this.logger.log(
      `Authentifizierung: OIDC=${oidcEnabled ? 'aktiv' : 'inaktiv'}, ` +
      `Lokal=${localEnabled ? 'aktiv' : 'inaktiv'}`,
    );

    if (localEnabled) {
      await this.adminBootstrap.bootstrap();
    }
  }
}
