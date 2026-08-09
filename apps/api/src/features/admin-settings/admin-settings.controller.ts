import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import { SettingsStoreService } from './settings-store.service';
import { RestartService } from './restart.service';
import {
  AppConfigService,
  DatabaseService,
  SettingsResolverService,
  getSettingDefinition,
  validateSettingValue,
} from '@versigo/foundation';
import type { SettingDefinition } from '@versigo/foundation';
import { CurrentUser } from '../identity/current-user.decorator';
import { HouseholdMembershipGuard } from '../identity/household-membership.guard';
import { Roles } from '../identity/roles.decorator';
import type { AuthenticatedUser } from '../identity/auth.service';
import {
  CreateGlobalSettingDto,
  UpdateGlobalSettingDto,
  CreateHouseholdSettingDto,
  UpdateHouseholdSettingDto,
  ConnectivityTestDto,
  ConnectivityTestResultDto,
  RestartServicesDto,
} from './dto/admin-settings.dto';
import { assertSafeTestEndpoint } from '../../common/connectivity/connectivity-guard';
import { testEndpoint } from '../../common/connectivity/connectivity-test';

// Helper: checks whether the user has the global role ADMIN (ADR-007)
function assertIsGlobalAdmin(user: AuthenticatedUser): void {
  if (user.role !== GlobalRole.ADMIN) {
    throw new ForbiddenException('Nur globale Administratoren koennen diese Aktion ausfuehren');
  }
}

@Controller()
export class AdminSettingsController {
  private readonly logger = new Logger(AdminSettingsController.name);

  constructor(
    private readonly settingsStore: SettingsStoreService,
    private readonly config: AppConfigService,
    private readonly db: DatabaseService,
    private readonly resolver: SettingsResolverService,
    private readonly restartService: RestartService,
  ) {}

  // =====================
  // Global Settings
  // =====================

  @Get('admin/settings')
  async listGlobalSettings(@CurrentUser() user: AuthenticatedUser) {
    assertIsGlobalAdmin(user);
    return this.settingsStore.listGlobalSettings();
  }

  @Get('admin/settings/:key')
  async getGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ) {
    assertIsGlobalAdmin(user);
    return this.settingsStore.getGlobalSetting(key);
  }

  @Post('admin/settings')
  async createGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGlobalSettingDto,
  ) {
    assertIsGlobalAdmin(user);
    // M3: legacy endpoints pass through the same catalog allowlist and
    // type validation as the new system configuration; isSecret is NEVER
    // taken from the caller but enforced from the catalog category.
    const definition = this.assertCatalogSetting(dto.key);
    // m9: creating an entry without a value would produce a "dead" row
    // that is not shown in any UI and cannot be reset.
    // `== null` catches both undefined and explicit null
    // (null passes @IsOptional() and would otherwise cause an HTTP-500 in
    // the type validation).
    if (dto.valuePlain == null) {
      throw new BadRequestException(
        `A value is required for '${dto.key}' (create).`,
      );
    }
    const { valuePlain, isSecret } = this.validateLegacyValue(definition, dto.valuePlain);
    return this.settingsStore.createGlobalSetting(dto.key, valuePlain, isSecret);
  }

  @Patch('admin/settings/:key')
  async updateGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateGlobalSettingDto,
  ) {
    assertIsGlobalAdmin(user);
    const definition = this.assertCatalogSetting(key);
    const { valuePlain, isSecret } = this.validateLegacyValue(definition, dto.valuePlain);
    return this.settingsStore.updateGlobalSetting(key, valuePlain, isSecret);
  }

  @Delete('admin/settings/:key')
  async deleteGlobalSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ) {
    assertIsGlobalAdmin(user);
    return this.settingsStore.deleteGlobalSetting(key);
  }

  // =====================
  // Connectivity Test
  // =====================

  @Post('admin/connectivity-test')
  async testConnectivity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectivityTestDto,
  ): Promise<ConnectivityTestResultDto> {
    assertIsGlobalAdmin(user);

    const result: ConnectivityTestResultDto = {
      success: false,
      message: '',
      timestamp: new Date().toISOString(),
    };

    try {
      switch (dto.integrationKey) {
        case 'database': {
          const healthy = await this.db.isHealthy();
          result.success = healthy;
          result.message = healthy
            ? 'Database connection successful'
            : 'Database connection failed';
          break;
        }
        default: {
          // Generic HTTP connectivity test for external services
          if (dto.endpoint) {
            // BugFix-06 (part 2): SSRF relaxation is explicitly opt-in. The
            // strict default (only public http(s) endpoints) remains in
            // place; only the admin setting
            // CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS allows local/private
            // endpoints (cloud metadata stays always blocked).
            const allowPrivate = await this.resolveBooleanSetting(
              'CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS',
            );
            const allowSelfSigned = await this.resolveBooleanSetting(
              'CONNECTIVITY_ALLOW_SELF_SIGNED',
            );
            try {
              await assertSafeTestEndpoint(dto.endpoint, { allowPrivate });
            } catch (error: unknown) {
              // M5-ext: same actionable guidance as for the system
              // configuration test, so users do not assume local services
              // are testable via the UI.
              result.message =
                `Endpoint rejected for security reasons: ` +
                `${(error as Error).message} – the connectivity test only allows ` +
                `public http(s) endpoints due to SSRF protection; please test ` +
                `local services (e.g. Ollama on localhost) directly on the host.`;
              break;
            }
            try {
              const tested = await testEndpoint(dto.endpoint, {
                token: dto.apiToken,
                rejectUnauthorized: allowSelfSigned ? false : true,
                // Check redirect targets with the same mode against the
                // SSRF guard (BugFix-06, review fix).
                allowPrivate,
              });
              result.success = tested.success;
              result.message = tested.message;
            } catch {
              result.success = false;
              result.message = 'Connection error: the endpoint is not reachable.';
            }
          } else {
            result.message = `No endpoint specified for integration '${dto.integrationKey}'`;
          }
          break;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.message = `Connection error: ${message}`;
    }

    return result;
  }

  // =====================
  // Dienste-Neustart (BugFix-06, Teil 3.4)
  // =====================

  /**
   * Restarts API and worker in a controlled way so that boot-relevant
   * settings (category "restart", e.g. OIDC bootstrap) take effect.
   * Global admins only. The HTTP response reaches the client (the API
   * process exits only after a short delay); Compose
   * (`restart: unless-stopped`) restarts the container.
   */
  @Post('admin/restart')
  async restartServices(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RestartServicesDto,
  ) {
    assertIsGlobalAdmin(user);
    await this.restartService.requestRestart(user, dto.reason);
    return { success: true, message: 'Restart of API and worker triggered.' };
  }

  // =====================
  // Config Validation
  // =====================

  @Get('admin/config-validation')
  async validateConfig(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertIsGlobalAdmin(user);

    const checks: { key: string; status: 'ok' | 'warn' | 'error'; message: string }[] = [];

    try {
      // Check database (reads a dummy entry)
      const dbOk = await this.config.get('DATABASE_URL')?.length > 0;
      checks.push({
        key: 'DATABASE_URL',
        status: dbOk ? 'ok' : 'error',
        message: dbOk ? 'DATABASE_URL ist gesetzt' : 'DATABASE_URL fehlt',
      });
    } catch {
      checks.push({
        key: 'DATABASE_URL',
        status: 'error',
        message: 'DATABASE_URL konnte nicht validiert werden',
      });
    }

    try {
      const redisUrl = this.config.get('REDIS_URL');
      checks.push({
        key: 'REDIS_URL',
        status: redisUrl?.length > 0 ? 'ok' : 'error',
        message: redisUrl?.length > 0 ? 'REDIS_URL ist gesetzt' : 'REDIS_URL fehlt',
      });
    } catch {
      checks.push({
        key: 'REDIS_URL',
        status: 'error',
        message: 'REDIS_URL konnte nicht validiert werden',
      });
    }

    // Encryption key
    try {
      const encKey = this.config.get('SETTINGS_ENCRYPTION_KEY');
      const isValid = /^[0-9a-fA-F]{64}$/.test(encKey);
      checks.push({
        key: 'SETTINGS_ENCRYPTION_KEY',
        status: isValid ? 'ok' : 'error',
        message: isValid
          ? 'SETTINGS_ENCRYPTION_KEY ist ein gueltiger 32-Byte-Hex-String'
          : 'SETTINGS_ENCRYPTION_KEY ist kein gueltiger 32-Byte-Hex-String',
      });
    } catch {
      checks.push({
        key: 'SETTINGS_ENCRYPTION_KEY',
        status: 'error',
        message: 'SETTINGS_ENCRYPTION_KEY konnte nicht validiert werden',
      });
    }

    // Session secret
    try {
      const sessionSecret = this.config.get('SESSION_SECRET');
      checks.push({
        key: 'SESSION_SECRET',
        status: sessionSecret && sessionSecret.length >= 32 ? 'ok' : 'error',
        message:
          sessionSecret && sessionSecret.length >= 32
            ? 'SESSION_SECRET ist ausreichend lang'
            : 'SESSION_SECRET ist zu kurz (min. 32 Zeichen)',
      });
    } catch {
      checks.push({
        key: 'SESSION_SECRET',
        status: 'error',
        message: 'SESSION_SECRET konnte nicht validiert werden',
      });
    }

    // Optional: OIDC configuration
    const oidcEnabled = this.config.get('OIDC_ENABLED');
    if (oidcEnabled) {
      checks.push({
        key: 'OIDC_ENABLED',
        status: 'ok',
        message: 'OIDC ist aktiviert',
      });

      const oidcIssuer = this.config.get('OIDC_ISSUER_URL');
      checks.push({
        key: 'OIDC_ISSUER_URL',
        status: oidcIssuer?.length ? 'ok' : 'error',
        message: oidcIssuer?.length ? 'OIDC_ISSUER_URL ist gesetzt' : 'OIDC_ISSUER_URL fehlt',
      });

      const oidcClientId = this.config.get('OIDC_CLIENT_ID');
      checks.push({
        key: 'OIDC_CLIENT_ID',
        status: oidcClientId?.length ? 'ok' : 'error',
        message: oidcClientId?.length ? 'OIDC_CLIENT_ID ist gesetzt' : 'OIDC_CLIENT_ID fehlt',
      });
    } else {
      checks.push({
        key: 'OIDC_ENABLED',
        status: 'warn',
        message: 'OIDC ist deaktiviert (nur lokal/Entwicklung)',
      });
    }

    // Check whether all required settings are present
    const appBaseUrl = this.config.get('APP_PORT');
    checks.push({
      key: 'APP_PORT',
      status: appBaseUrl ? 'ok' : 'warn',
      message: appBaseUrl
        ? `API-Port: ${appBaseUrl}`
        : 'APP_PORT nicht gesetzt, verwende Standard 3001',
    });

    return {
      valid: checks.every((c) => c.status !== 'error'),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  // =====================
  // Household Settings (household-scoped)
  // =====================

  @Get('households/:householdId/admin/settings')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async listHouseholdSettings(
    @Param('householdId') householdId: string,
  ) {
    return this.settingsStore.listHouseholdSettings(householdId);
  }

  @Get('households/:householdId/admin/settings/:key')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async getHouseholdSetting(
    @Param('householdId') householdId: string,
    @Param('key') key: string,
  ) {
    return this.settingsStore.getHouseholdSetting(householdId, key);
  }

  @Post('households/:householdId/admin/settings')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async createHouseholdSetting(
    @Param('householdId') householdId: string,
    @Body() dto: CreateHouseholdSettingDto,
  ) {
    return this.settingsStore.createHouseholdSetting(
      householdId,
      dto.key,
      dto.valuePlain,
      dto.isSecret,
    );
  }

  @Patch('households/:householdId/admin/settings/:key')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async updateHouseholdSetting(
    @Param('householdId') householdId: string,
    @Param('key') key: string,
    @Body() dto: UpdateHouseholdSettingDto,
  ) {
    return this.settingsStore.updateHouseholdSetting(
      householdId,
      key,
      dto.valuePlain,
      dto.isSecret,
    );
  }

  @Delete('households/:householdId/admin/settings/:key')
  @UseGuards(HouseholdMembershipGuard)
  @Roles(GlobalRole.ADMIN)
  async deleteHouseholdSetting(
    @Param('householdId') householdId: string,
    @Param('key') key: string,
  ) {
    return this.settingsStore.deleteHouseholdSetting(householdId, key);
  }

  // =====================
  // Internal (M3): catalog allowlist + value validation for legacy endpoints
  // =====================

  /**
   * Reads a catalogued boolean key through the central resolution
   * (UI > .env > default). A resolution error degrades safely to
   * `false` (= strict behavior), so a broken DB value never
   * relaxes the SSRF protection.
   */
  private async resolveBooleanSetting(key: string): Promise<boolean> {
    try {
      return (await this.resolver.getEffectiveBoolean(key)) ?? false;
    } catch (error) {
      this.logger.warn(
        `Setting '${key}' could not be resolved – using strict default: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Allowlist check for the legacy global-settings endpoints: the key
   * must exist in the versioned settings catalog and must not belong
   * to the bootstrap category (only environment/Compose). Unknown or
   * bootstrap keys can neither be created nor changed via the UI.
   */
  private assertCatalogSetting(key: string): SettingDefinition {
    const definition = getSettingDefinition(key);
    if (!definition) {
      throw new BadRequestException(
        `Unknown settings key '${key}' – not in the catalog (allowlist).`,
      );
    }
    if (definition.category === 'bootstrap') {
      throw new BadRequestException(
        `'${key}' is an infrastructure/bootstrap configuration and can only be set via environment/Compose.`,
      );
    }
    return definition;
  }

  /**
   * Value validation + enforced secret flag: `isSecret` is NEVER taken
   * from the caller but derived exclusively from the catalog category.
   * A catalog secret can thus not be stored in plaintext, and a
   * non-secret cannot accidentally become a secret.
   */
  private validateLegacyValue(
    definition: SettingDefinition,
    valuePlain: string | undefined,
  ): { valuePlain: string | undefined; isSecret: boolean } {
    const isSecret = definition.category === 'secret';
    if (valuePlain === undefined) {
      return { valuePlain: undefined, isSecret };
    }
    const validated = validateSettingValue(definition, valuePlain);
    if (!validated.ok) {
      throw new BadRequestException(
        `Invalid value for '${definition.key}': ${validated.error}`,
      );
    }
    return { valuePlain: validated.canonical, isSecret };
  }
}
