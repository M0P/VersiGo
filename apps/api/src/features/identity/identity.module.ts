import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CapabilityFlagsService } from '@insura/foundation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OidcStrategy } from './oidc.strategy';
import { SessionAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { HouseholdMembershipGuard } from './household-membership.guard';
import { PasswordHashingService } from './password-hashing.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { LocalAdminBootstrapService } from './local-admin.bootstrap';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OidcStrategy,
    PasswordHashingService,
    LoginRateLimiterService,
    HouseholdMembershipGuard,
    LocalAdminBootstrapService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, HouseholdMembershipGuard],
})
export class IdentityModule implements OnModuleInit {
  private readonly logger = new Logger(IdentityModule.name);

  constructor(
    private readonly capabilities: CapabilityFlagsService,
    private readonly adminBootstrap: LocalAdminBootstrapService,
  ) {}

  async onModuleInit(): Promise<void> {
    const oidcEnabled = this.capabilities.isEnabled('oidc');
    const localEnabled = this.capabilities.isEnabled('local');

    if (!oidcEnabled && !localEnabled) {
      this.logger.error(
        'KEINE AUTHENTIFIZIERUNGSMETHODE KONFIGURIERT. ' +
        'Setze mindestens eine der folgenden Umgebungsvariablen: ' +
        'OIDC_ENABLED=true oder LOCAL_AUTH_ENABLED=true. ' +
        'Die Anwendung wird ohne Authentifizierung nicht gestartet.',
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
