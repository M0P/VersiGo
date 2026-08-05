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
    // BugFix-05: Capability-Aufloesung laeuft seit der Resolver-Umstellung
    // asynchron (UI > ENV > DEFAULT). Ist die Datenbank beim Boot nicht
    // erreichbar (Prisma-Verbindung lazy, $connect() prueft nicht), faellt
    // die Identitaets-Konfiguration auf den Umgebungs-Snapshot zurueck
    // (Verhalten vor BugFix-05): Die API startet dann trotz DB-Ausfall und
    // der Health-Endpunkt meldet db: down, statt den Boot zu verhindern.
    let oidcEnabled: boolean;
    let localEnabled: boolean;
    try {
      [oidcEnabled, localEnabled] = await Promise.all([
        this.capabilities.isEnabled('oidc'),
        this.capabilities.isEnabled('local'),
      ]);
    } catch (error) {
      this.logger.warn(
        'Capability-Aufloesung beim Boot fehlgeschlagen (DB nicht erreichbar?) – ' +
          'Fallback auf Umgebungs-Konfiguration: ' +
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
